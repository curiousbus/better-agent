import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import type { TokenService } from "@better-agent/agent/crypto/agent-token";
import type { JwtService } from "@better-agent/agent/crypto/jwt";
import type {
	AgentStore,
	AttachmentStore,
	AuthzClient,
	BridgeSessionStore,
	BridgeTokenStore,
	ComposioAccountStore,
	EmailSender,
	GoogleOAuth,
	MagicLinkStore,
	McpServerStore,
	MessageStore,
	ModelCacheStore,
	PasswordResetStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	RefreshTokenStore,
	RelayStore,
	SessionStore,
	SettingsStore,
	UserStore,
	WebAuthzCacheStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import type { SessionRuntime } from "@better-agent/agent/session/runtime";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import type { McpService } from "@better-agent/agent/tool/mcp-tools";
import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import type { ActivityStore } from "@better-agent/db/repositories/activity-store";
import type { UsageStore } from "@better-agent/db/repositories/usage-store";

export interface AgentServices {
	agentValidator: AgentValidator;
	authConfig: {
		webUrl: string;
		adminUrl: string;
		accessTtl: number;
		refreshTtl: number;
		magicLinkTtl: number;
		adminEmails: string[];
	};
	authz: AuthzClient;
	cancellation: CancellationRegistry;
	catalog: ModelCatalog;
	composio: (accountId: string) => Promise<ComposioService | null>;
	emailSender: EmailSender;
	googleOAuth: GoogleOAuth | null;
	jwtService: JwtService;
	mcp: (serverId: string) => Promise<McpService | null>;
	modelFactory: ModelFactory;
	pendingToolCallStore: PendingToolCallStore;
	rateLimiter: RateLimiter;
	relayStore: RelayStore;
	runtime: SessionRuntime;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
		session: SessionStore;
		message: MessageStore;
		attachment: AttachmentStore;
		user: UserStore;
		magicLink: MagicLinkStore;
		passwordReset: PasswordResetStore;
		refreshToken: RefreshTokenStore;
		settings: SettingsStore;
		composioAccount: ComposioAccountStore;
		mcpServer: McpServerStore;
		usage: UsageStore;
		activity: ActivityStore;
		webAuthzCache: WebAuthzCacheStore;
		bridgeToken: BridgeTokenStore;
		bridgeSession: BridgeSessionStore;
	};
	tokenService: TokenService;
}
