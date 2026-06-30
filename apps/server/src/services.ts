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
import { createAttachmentMetaStore } from "@better-agent/db/repositories/attachment-meta-store";
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
import { createSprintStore } from "@better-agent/db/repositories/sprint-store";
import { createTaskStore } from "@better-agent/db/repositories/task-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import { Redis as UpstashRedis } from "@upstash/redis";
import Redis from "ioredis";
import { createAttachmentStore, type R2Bucket } from "./attachment-store";
import { buildAuthzClient, type ServiceBinding } from "./authz-client";
import { createEmailSender } from "./email-sender";
import {
	buildComposioAccountResolver,
	buildGoogleOAuth,
} from "./optional-services";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisSessionLock } from "./redis-session-lock";
import { createUpstashCancellationRegistry } from "./upstash-cancellation";
import { createUpstashPendingToolCallStore } from "./upstash-pending-store";

type Db = Parameters<typeof createAgentStore>[0];
const ACCESS_TTL = 900;
const REFRESH_TTL = 2_592_000;
const MAGIC_LINK_TTL = 900;

// scrypt key derivation is slow — memoize the secret box per isolate.
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

// Upstash REST client for cross-isolate coordination on Cloudflare Workers.
function upstashRedis(): UpstashRedis | null {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	return url && token ? new UpstashRedis({ url, token }) : null;
}

function buildPendingToolCallStore() {
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashPendingToolCallStore(upstash);
	}
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
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashCancellationRegistry(upstash);
	}
	return env.REDIS_URL
		? createRedisCancellationRegistry(new Redis(env.REDIS_URL))
		: createInMemoryCancellationRegistry();
}

function buildRateLimiter() {
	return env.REDIS_URL
		? createRedisRateLimiter(new Redis(env.REDIS_URL))
		: createInMemoryRateLimiter();
}

function buildRuntime(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	cancellation: CancellationRegistry;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	sessionStore: ReturnType<typeof createSessionStore>;
}) {
	const { deps, sessionStore, messageStore, cancellation, attachmentStore } =
		parts;
	return createSessionRuntime({
		sessionStore,
		messageStore,
		attachmentStore,
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

function buildStores(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	authStores: ReturnType<typeof buildAuthServices>["authStores"];
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	sprintStore: ReturnType<typeof createSprintStore>;
	taskStore: ReturnType<typeof createTaskStore>;
	webAuthzCache: ReturnType<typeof createWebAuthzCacheStore>;
}) {
	const { deps, authStores } = parts;
	return {
		providerCatalog: deps.providerCatalog,
		modelCache: deps.modelCache,
		providerCredential: deps.providerCredential,
		agent: deps.agentStore,
		session: parts.sessionStore,
		message: parts.messageStore,
		attachment: parts.attachmentStore,
		settings: parts.settings,
		composioAccount: parts.composioAccount,
		sprint: parts.sprintStore,
		task: parts.taskStore,
		webAuthzCache: parts.webAuthzCache,
		...authStores,
	};
}

function assembleServices(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	auth: ReturnType<typeof buildAuthServices>;
	authzBinding?: ServiceBinding;
	cancellation: CancellationRegistry;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	runtime: ReturnType<typeof buildRuntime>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	sprintStore: ReturnType<typeof createSprintStore>;
	taskStore: ReturnType<typeof createTaskStore>;
	webAuthzCache: ReturnType<typeof createWebAuthzCacheStore>;
}) {
	const { deps, auth } = parts;
	return {
		catalog: createModelCatalog({
			catalogStore: deps.providerCatalog,
			modelStore: deps.modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
			allowedProviders: env.CATALOG_PROVIDERS,
		}),
		modelFactory: deps.modelFactory,
		agentValidator: deps.agentValidator,
		runtime: parts.runtime,
		tokenService: createTokenService(),
		jwtService: auth.jwtService,
		emailSender: auth.emailSender,
		authConfig: auth.authConfig,
		cancellation: parts.cancellation,
		pendingToolCallStore: buildPendingToolCallStore(),
		googleOAuth: buildGoogleOAuth(),
		composio: buildComposioAccountResolver(parts.composioAccount),
		authz: buildAuthzClient(parts.authzBinding),
		rateLimiter: buildRateLimiter(),
		stores: buildStores({
			deps,
			sessionStore: parts.sessionStore,
			messageStore: parts.messageStore,
			attachmentStore: parts.attachmentStore,
			settings: parts.settings,
			composioAccount: parts.composioAccount,
			sprintStore: parts.sprintStore,
			taskStore: parts.taskStore,
			webAuthzCache: parts.webAuthzCache,
			authStores: auth.authStores,
		}),
	};
}

export function buildServices(
	db: Db,
	authzBinding?: ServiceBinding,
	uploads?: R2Bucket
) {
	const secretBox = getSecretBox();
	const deps = buildProviderDeps(db, secretBox);
	const sessionStore = createSessionStore(db);
	const messageStore = createMessageStore(db);
	const sprintStore = createSprintStore(db);
	const taskStore = createTaskStore(db);
	const attachmentStore = createAttachmentStore(
		createAttachmentMetaStore(db),
		uploads
	);
	const cancellation = buildCancellation();
	const runtime = buildRuntime({
		deps,
		sessionStore,
		messageStore,
		cancellation,
		attachmentStore,
	});
	return assembleServices({
		deps,
		runtime,
		cancellation,
		attachmentStore,
		sessionStore,
		messageStore,
		sprintStore,
		taskStore,
		auth: buildAuthServices(db),
		settings: createSettingsStore(db, secretBox),
		composioAccount: createComposioAccountStore(db, secretBox),
		webAuthzCache: createWebAuthzCacheStore(db),
		authzBinding,
	});
}
