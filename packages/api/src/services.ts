import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import type { TokenService } from "@better-agent/agent/crypto/agent-token";
import type { JwtService } from "@better-agent/agent/crypto/jwt";
import type {
	AgentStore,
	EmailSender,
	MagicLinkStore,
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	RefreshTokenStore,
	SessionStore,
	UserStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import type { SessionRuntime } from "@better-agent/agent/session/runtime";
import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";

export interface AgentServices {
	agentValidator: AgentValidator;
	authConfig: {
		webUrl: string;
		accessTtl: number;
		refreshTtl: number;
		magicLinkTtl: number;
	};
	cancellation: CancellationRegistry;
	catalog: ModelCatalog;
	emailSender: EmailSender;
	jwtService: JwtService;
	modelFactory: ModelFactory;
	pendingToolCallStore: PendingToolCallStore;
	rateLimiter: RateLimiter;
	runtime: SessionRuntime;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
		session: SessionStore;
		message: MessageStore;
		user: UserStore;
		magicLink: MagicLinkStore;
		refreshToken: RefreshTokenStore;
	};
	tokenService: TokenService;
}
