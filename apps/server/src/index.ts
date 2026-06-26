import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import {
	type CancellationRegistry,
	createInMemoryCancellationRegistry,
} from "@better-agent/agent/session/cancellation";
import { createModelSummarizer } from "@better-agent/agent/session/model-summarizer";
import { createModelTitler } from "@better-agent/agent/session/model-titler";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createContext } from "@better-agent/api/context";
import { appRouter } from "@better-agent/api/routers/index";
import { db } from "@better-agent/db";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import {
	createMagicLinkStore,
	createPasswordResetStore,
	createRefreshTokenStore,
	createUserStore,
} from "@better-agent/db/repositories/auth-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
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
import Redis from "ioredis";
import { createEmailSender } from "./email-sender";
import { buildComposioResolver, buildGoogleOAuth } from "./optional-services";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisSessionLock } from "./redis-session-lock";

initLogger({
	env: { service: "better-agent-server" },
});

const ACCESS_TTL = 900;
const REFRESH_TTL = 2_592_000;
const MAGIC_LINK_TTL = 900;

function buildAuthServices() {
	return {
		jwtService: createJwtService(env.AUTH_JWT_SECRET),
		emailSender: createEmailSender({
			apiKey: env.RESEND_API_KEY,
			from: env.AUTH_EMAIL_FROM,
		}),
		authConfig: {
			webUrl: env.WEB_URL,
			adminUrl: env.ADMIN_URL,
			accessTtl: ACCESS_TTL,
			refreshTtl: REFRESH_TTL,
			magicLinkTtl: MAGIC_LINK_TTL,
			adminEmails: env.ADMIN_EMAILS,
		},
		authStores: {
			user: createUserStore(db),
			magicLink: createMagicLinkStore(db),
			passwordReset: createPasswordResetStore(db),
			refreshToken: createRefreshTokenStore(db),
		},
	};
}

function buildProviderDeps(secretBox: ReturnType<typeof createSecretBox>) {
	const providerCatalog = createProviderCatalogStore(db);
	const modelCache = createModelCacheStore(db);
	const providerCredential = createProviderCredentialStore(db, secretBox);
	const agentStore = createAgentStore(db, secretBox);
	const modelFactory = createModelFactory({
		catalogStore: providerCatalog,
		credentialStore: providerCredential,
	});
	const agentValidator = createAgentValidator({
		credentialStore: providerCredential,
		modelStore: modelCache,
	});
	return {
		providerCatalog,
		modelCache,
		providerCredential,
		agentStore,
		modelFactory,
		agentValidator,
	};
}

function buildPendingToolCallStore() {
	return env.REDIS_URL
		? createRedisPendingToolCallStore(new Redis(env.REDIS_URL))
		: createInMemoryPendingToolCallStore();
}

function buildSessionLock() {
	return env.REDIS_URL
		? createRedisSessionLock(new Redis(env.REDIS_URL))
		: createInMemorySessionLock();
}

function buildCancellation() {
	return env.REDIS_URL
		? createRedisCancellationRegistry(new Redis(env.REDIS_URL))
		: createInMemoryCancellationRegistry();
}

function buildRateLimiter() {
	return env.REDIS_URL
		? createRedisRateLimiter(new Redis(env.REDIS_URL))
		: createInMemoryRateLimiter();
}

function buildRuntime(
	deps: ReturnType<typeof buildProviderDeps>,
	sessionStore: ReturnType<typeof createSessionStore>,
	messageStore: ReturnType<typeof createMessageStore>,
	cancellation: CancellationRegistry
) {
	return createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore: deps.agentStore,
		modelFactory: deps.modelFactory,
		sessionLock: buildSessionLock(),
		modelCacheStore: deps.modelCache,
		providerCatalogStore: deps.providerCatalog,
		summarizer: createModelSummarizer(deps.modelFactory),
		titler: createModelTitler(deps.modelFactory),
		cancellation,
	});
}

function buildServices() {
	const secretBox = createSecretBox(env.CREDENTIALS_SECRET);
	const deps = buildProviderDeps(secretBox);
	const sessionStore = createSessionStore(db);
	const messageStore = createMessageStore(db);
	const cancellation = buildCancellation();
	const runtime = buildRuntime(deps, sessionStore, messageStore, cancellation);
	const { jwtService, emailSender, authConfig, authStores } =
		buildAuthServices();
	const settings = createSettingsStore(db, secretBox);
	return {
		catalog: createModelCatalog({
			catalogStore: deps.providerCatalog,
			modelStore: deps.modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
			allowedProviders: env.CATALOG_PROVIDERS,
		}),
		modelFactory: deps.modelFactory,
		agentValidator: deps.agentValidator,
		runtime,
		tokenService: createTokenService(),
		jwtService,
		emailSender,
		authConfig,
		cancellation,
		pendingToolCallStore: buildPendingToolCallStore(),
		googleOAuth: buildGoogleOAuth(),
		composio: buildComposioResolver(settings),
		envSecretKeys: env.COMPOSIO_API_KEY ? ["COMPOSIO_API_KEY"] : [],
		rateLimiter: buildRateLimiter(),
		stores: {
			providerCatalog: deps.providerCatalog,
			modelCache: deps.modelCache,
			providerCredential: deps.providerCredential,
			agent: deps.agentStore,
			session: sessionStore,
			message: messageStore,
			settings,
			...authStores,
		},
	};
}

const services = buildServices();

const app = new Hono<EvlogVariables>();

// evlog's streaming-response observation re-reads the response body, which
// conflicts with oRPC event-iterator streams and throws "ReadableStream is
// locked". Skip it for the streaming prompt endpoint; log everything else.
const evlogMiddleware = evlog();
// Streaming (event-iterator) endpoints must skip the logging middleware: it
// buffers the response, which locks the body stream and makes the streamed
// response throw "ReadableStream is locked". Both the agent plane
// (sessions/prompt) and the user/web plane (userSessions/prompt) stream.
const STREAMING_PATHS = new Set([
	"/rpc/sessions/prompt",
	"/rpc/userSessions/prompt",
]);
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
