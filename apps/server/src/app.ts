import { createContext } from "@better-agent/api/context";
import { appRouter } from "@better-agent/api/routers/index";
import { env } from "@better-agent/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { log } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Streaming (event-iterator) endpoints must skip the logging middleware: it
// buffers the response, which locks the body stream and makes the streamed
// response throw "ReadableStream is locked". Both the agent plane
// (sessions/prompt) and the user/web plane (userSessions/prompt) stream.
const STREAMING_PATHS = new Set([
	"/rpc/sessions/prompt",
	"/rpc/userSessions/prompt",
]);

const HTTP_INTERNAL_SERVER_ERROR = 500;

const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

export type AgentServices = Parameters<typeof createContext>[0]["services"];

function applyMiddleware(app: Hono<EvlogVariables>): void {
	const evlogMiddleware = evlog();
	app.use("/*", (c, next) =>
		STREAMING_PATHS.has(c.req.path) ? next() : evlogMiddleware(c, next)
	);
	app.use(
		"/*",
		cors({ origin: env.CORS_ORIGIN, allowMethods: ["GET", "POST", "OPTIONS"] })
	);
	// The cors() middleware sets the allow-origin header AFTER the handler runs,
	// so a thrown error skips it — the browser masks the real 500 as a CORS
	// failure. Re-apply the header here so error responses stay readable.
	app.onError((error, c) => {
		const origin = c.req.header("origin");
		if (origin && env.CORS_ORIGIN.includes(origin)) {
			c.header("Access-Control-Allow-Origin", origin);
		}
		log.error({ error });
		return c.text("Internal Server Error", HTTP_INTERNAL_SERVER_ERROR);
	});
}

function applyRpcHandler(
	app: Hono<EvlogVariables>,
	services: AgentServices
): void {
	// Return the handler's Response directly. Re-wrapping via
	// c.newResponse(response.body, response) attaches a second reader to the
	// same body stream, throwing "ReadableStream is locked" for streaming
	// responses (e.g. sessions.prompt).
	app.use("/*", async (c, next) => {
		const context = await createContext({ context: c, services });
		const rpcResult = await rpcHandler.handle(c.req.raw, {
			prefix: "/rpc",
			context,
		});
		if (rpcResult.matched) {
			return rpcResult.response;
		}
		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: "/api-reference",
			context,
		});
		if (apiResult.matched) {
			return apiResult.response;
		}
		return await next();
	});
}

export function buildApp(services: AgentServices): Hono<EvlogVariables> {
	const app = new Hono<EvlogVariables>();
	applyMiddleware(app);
	applyRpcHandler(app, services);
	app.get("/", (c) => c.text("OK"));
	return app;
}
