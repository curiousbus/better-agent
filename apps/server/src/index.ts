import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createContext } from "@better-agent/api/context";
import { appRouter } from "@better-agent/api/routers/index";
import { db } from "@better-agent/db";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { env } from "@better-agent/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger, log } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

initLogger({
	env: { service: "better-agent-server" },
});

function buildServices() {
	const secretBox = createSecretBox(env.CREDENTIALS_SECRET);
	const providerCatalog = createProviderCatalogStore(db);
	const modelCache = createModelCacheStore(db);
	const providerCredential = createProviderCredentialStore(db, secretBox);
	const agent = createAgentStore(db, secretBox);
	const tokenService = createTokenService();
	const agentValidator = createAgentValidator({
		credentialStore: providerCredential,
		modelStore: modelCache,
	});
	const session = createSessionStore(db);
	const message = createMessageStore(db);
	const modelFactory = createModelFactory({
		catalogStore: providerCatalog,
		credentialStore: providerCredential,
	});
	const runtime = createSessionRuntime({
		sessionStore: session,
		messageStore: message,
		agentStore: agent,
		modelFactory,
	});
	return {
		catalog: createModelCatalog({
			catalogStore: providerCatalog,
			modelStore: modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
			allowedProviders: env.CATALOG_PROVIDERS,
		}),
		modelFactory,
		agentValidator,
		runtime,
		tokenService,
		stores: {
			providerCatalog,
			modelCache,
			providerCredential,
			agent,
			session,
			message,
		},
	};
}

const services = buildServices();

const app = new Hono<EvlogVariables>();

// evlog's streaming-response observation re-reads the response body, which
// conflicts with oRPC event-iterator streams and throws "ReadableStream is
// locked". Skip it for the streaming prompt endpoint; log everything else.
const evlogMiddleware = evlog();
const STREAMING_PATHS = new Set(["/rpc/sessions/prompt"]);
app.use("/*", (c, next) =>
	STREAMING_PATHS.has(c.req.path) ? next() : evlogMiddleware(c, next)
);

app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
	})
);

// The cors() middleware sets the allow-origin header AFTER the handler runs, so
// a thrown error (e.g. a streaming handler that throws before its first chunk)
// skips it — the browser then masks the real 500 as a CORS failure. Re-apply
// the header here so error responses stay readable cross-origin.
app.onError((error, c) => {
	const origin = c.req.header("origin");
	if (origin && env.CORS_ORIGIN.includes(origin)) {
		c.header("Access-Control-Allow-Origin", origin);
	}
	log.error({ error });
	return c.text("Internal Server Error", 500);
});

export const apiHandler = new OpenAPIHandler(appRouter, {
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

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c, services });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});

	// Return the handler's Response directly. Re-wrapping it via
	// c.newResponse(response.body, response) attaches a second reader to the
	// same body stream, which throws "ReadableStream is locked" for streaming
	// responses (e.g. sessions.prompt) — a 500 that also skips CORS.
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

app.get("/", (c) => c.text("OK"));

import { serve } from "@hono/node-server";

serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		log.info("server", `Server is running on http://localhost:${info.port}`);
	}
);
