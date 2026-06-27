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
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import {
	createMagicLinkStore,
	createPasswordResetStore,
	createRefreshTokenStore,
	createUserStore,
} from "@better-agent/db/repositories/auth-store";
import { createComposioAccountStore } from "@better-agent/db/repositories/composio-account-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import Redis from "ioredis";
import { buildAuthzClient } from "./authz-client";
import { createEmailSender } from "./email-sender";
import {
	buildComposioAccountResolver,
	buildGoogleOAuth,
} from "./optional-services";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisSessionLock } from "./redis-session-lock";

type Db = Parameters<typeof createAgentStore>[0];

const ACCESS_TTL = 900;
const REFRESH_TTL = 2_592_000;
const MAGIC_LINK_TTL = 900;

// The secret box derives its key with scrypt (~tens of ms), so it must not be
// rebuilt per request. It depends only on the (process-wide) secret, so memoize
// it per isolate even though the rest of the services are built per request.
let cachedSecretBox: ReturnType<typeof createSecretBox> | null = null;
function getSecretBox() {
	cachedSecretBox ??= createSecretBox(env.CREDENTIALS_SECRET);
	return cachedSecretBox;
}

function buildAuthServices(db: Db) {
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

function buildProviderDeps(
	db: Db,
	secretBox: ReturnType<typeof createSecretBox>
) {
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

function buildCancellation(): CancellationRegistry {
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

export function buildServices(db: Db) {
	const secretBox = getSecretBox();
	const deps = buildProviderDeps(db, secretBox);
	const sessionStore = createSessionStore(db);
	const messageStore = createMessageStore(db);
	const cancellation = buildCancellation();
	const runtime = buildRuntime(deps, sessionStore, messageStore, cancellation);
	const { jwtService, emailSender, authConfig, authStores } =
		buildAuthServices(db);
	const settings = createSettingsStore(db, secretBox);
	const composioAccount = createComposioAccountStore(db, secretBox);
	const webAuthzCache = createWebAuthzCacheStore(db);
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
		composio: buildComposioAccountResolver(composioAccount),
		authz: buildAuthzClient(),
		rateLimiter: buildRateLimiter(),
		stores: {
			providerCatalog: deps.providerCatalog,
			modelCache: deps.modelCache,
			providerCredential: deps.providerCredential,
			agent: deps.agentStore,
			session: sessionStore,
			message: messageStore,
			settings,
			composioAccount,
			webAuthzCache,
			...authStores,
		},
	};
}
