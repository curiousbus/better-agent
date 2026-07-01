import type { AgentConfig, AgentInput } from "./agent/types";
import type {
	AdminUserRow,
	RefreshTokenRecord,
	User,
	UserKind,
} from "./auth/types";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "./provider/types";
import type {
	Message,
	MessageInput,
	MessagePart,
	MessagePartInput,
	MessagePartPatch,
	MessagePatch,
	MessageWithParts,
	Session,
	SessionInput,
	SessionStatus,
} from "./session/types";
import type { Sprint, SprintStatus, Task, TaskStatus } from "./task/types";

export interface ProviderCatalogStore {
	get(providerId: string): Promise<ProviderCatalogEntry | null>;
	list(): Promise<ProviderCatalogEntry[]>;
	replaceAll(entries: ProviderCatalogEntry[]): Promise<void>;
}

export interface ModelCacheStore {
	get(providerId: string, modelId: string): Promise<ModelEntry | null>;
	listByProvider(providerId: string): Promise<ModelEntry[]>;
	replaceAll(entries: ModelEntry[]): Promise<void>;
}

/** 注意：`get` 返回**已解密**的 apiKey；加解密在仓储实现里完成。 */
export interface ProviderCredentialStore {
	delete(providerId: string): Promise<void>;
	get(providerId: string): Promise<ProviderCredential | null>;
	/** 列表用，apiKey 字段被脱敏成末四位。 */
	listMasked(): Promise<
		Array<Omit<ProviderCredential, "apiKey"> & { last4: string }>
	>;
	upsert(input: ProviderCredential): Promise<void>;
}

export interface AgentStore {
	create(
		input: AgentInput & { tokenHash: string; token?: string; userId?: string }
	): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	findByTokenHash(tokenHash: string): Promise<AgentConfig | null>;
	get(id: string): Promise<AgentConfig | null>;
	/** The agent's current plaintext token, decrypted from storage (null if none). */
	getToken(id: string): Promise<string | null>;
	list(): Promise<AgentConfig[]>;
	listByUser(userId: string): Promise<AgentConfig[]>;
	rotateToken(
		id: string,
		tokenHash: string,
		token?: string
	): Promise<AgentConfig | null>;
	update(id: string, input: AgentInput): Promise<AgentConfig | null>;
}

export interface SessionStore {
	create(input: SessionInput): Promise<Session>;
	get(id: string): Promise<Session | null>;
	list(): Promise<Session[]>;
	listByAgent(agentId: string): Promise<Session[]>;
	listByUser(userId: string): Promise<Session[]>;
	setStatus(id: string, status: SessionStatus): Promise<void>;
	/** 📐 P2 compaction 写入。 */
	setSummary(
		id: string,
		summary: string,
		compactedThroughSeq: number
	): Promise<void>;
	setTitle(id: string, title: string): Promise<void>;
}

export interface MessageStore {
	appendPart(input: MessagePartInput): Promise<MessagePart>;
	createMessage(input: MessageInput): Promise<Message>;
	/** 按 message.seq 升序返回会话全部消息及其 parts（历史回放 + toModelMessages 用）。 */
	listWithParts(sessionId: string): Promise<MessageWithParts[]>;
	updateMessage(id: string, patch: MessagePatch): Promise<Message | null>;
	updatePart(id: string, patch: MessagePartPatch): Promise<MessagePart | null>;
}

/** An uploaded attachment's metadata (bytes live in object storage). */
export interface AttachmentRow {
	createdAt: Date;
	id: string;
	messageId: string | null;
	mime: string;
	name: string;
	sessionId: string;
	size: number;
}

export interface AttachmentStore {
	/** Store the bytes + a metadata row (message_id null until linked). */
	create(input: {
		data: Uint8Array;
		mime: string;
		name: string;
		sessionId: string;
	}): Promise<AttachmentRow>;
	getById(id: string): Promise<AttachmentRow | null>;
	/** Raw bytes from object storage; null if the row or object is missing. */
	getBytes(id: string): Promise<Uint8Array | null>;
	/** Bind uploaded attachments to the message they were sent with. */
	linkToMessage(ids: string[], messageId: string): Promise<void>;
	listByMessage(messageId: string): Promise<AttachmentRow[]>;
}

export interface UserStore {
	createWithPassword(
		email: string,
		passwordHash: string,
		kind: UserKind
	): Promise<User>;
	deleteById(userId: string): Promise<void>;
	findByEmail(email: string): Promise<User | null>;
	findById(id: string): Promise<User | null>;
	findCredentialByEmail(email: string): Promise<{
		id: string;
		email: string;
		passwordHash: string | null;
		kind: UserKind;
	} | null>;
	findOrCreate(email: string): Promise<User>;
	hasPassword(userId: string): Promise<boolean>;
	isAdmin(userId: string): Promise<boolean>;
	isEmailVerified(userId: string): Promise<boolean>;
	listByKind(kind: UserKind): Promise<AdminUserRow[]>;
	markEmailVerified(userId: string): Promise<void>;
	setPasswordHash(userId: string, passwordHash: string): Promise<void>;
	/** Promote a user to staff (back-office admin). */
	setStaff(userId: string): Promise<void>;
}

export interface MagicLinkStore {
	consume(tokenHash: string): Promise<{ email: string } | null>;
	create(input: {
		tokenHash: string;
		email: string;
		expiresAt: Date;
	}): Promise<void>;
}

export interface RefreshTokenStore {
	create(input: {
		userId: string;
		tokenHash: string;
		expiresAt: Date;
		userAgent?: string | null;
	}): Promise<void>;
	find(tokenHash: string): Promise<RefreshTokenRecord | null>;
	listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;
	revoke(id: string): Promise<void>;
	revokeAllForUser(userId: string): Promise<void>;
	revokeForUser(id: string, userId: string): Promise<void>;
	revokeOthersForUser(userId: string, exceptTokenHash: string): Promise<void>;
}

export interface PasswordResetStore {
	/** Single-use: returns the userId and marks it used; null if missing/used/expired. */
	consume(tokenHash: string): Promise<{ userId: string } | null>;
	create(input: {
		userId: string;
		tokenHash: string;
		expiresAt: Date;
	}): Promise<void>;
}

export interface SettingsStore {
	delete(key: string): Promise<void>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
}

/** A composio account as exposed to clients: never includes the key cipher. */
export interface ComposioAccountRow {
	apiKeyLast4: string;
	createdAt: Date;
	id: string;
	name: string;
}

export interface ComposioAccountStore {
	create(input: { name: string; apiKey: string }): Promise<ComposioAccountRow>;
	delete(id: string): Promise<void>;
	/** Decrypted key — server-side only, for building a ComposioService. */
	getApiKey(id: string): Promise<string | null>;
	getById(id: string): Promise<ComposioAccountRow | null>;
	list(): Promise<ComposioAccountRow[]>;
}

export interface WebAuthzCacheRow {
	authorized: boolean;
	checkedAt: Date;
	subject: string;
}

export interface WebAuthzCacheStore {
	clear(subjects: string[]): Promise<void>;
	get(subject: string): Promise<WebAuthzCacheRow | null>;
	set(subject: string, authorized: boolean): Promise<void>;
}

/** Client for the standalone authz (invite-code) service. */
export interface AuthzClient {
	authorize(subject: string): Promise<boolean>;
	/** Whether the authz feature is enabled (AUTHZ_URL configured). */
	readonly enabled: boolean;
	redeem(
		subject: string,
		code: string
	): Promise<{ authorized: boolean; reason?: string }>;
}

export interface EmailSender {
	sendMagicLink(input: { email: string; url: string }): Promise<void>;
	sendPasswordReset(input: { email: string; url: string }): Promise<void>;
}

export interface GoogleProfile {
	email: string;
	emailVerified: boolean;
}

export interface GoogleOAuth {
	/** The Google consent URL to redirect the user to. */
	authUrl(state: string): string;
	/** Exchange the authorization code for the user's verified email. */
	exchangeCode(code: string): Promise<GoogleProfile>;
}

export interface SprintStore {
	active(userId: string): Promise<Sprint | null>;
	create(
		userId: string,
		input: {
			endDate?: string | null;
			goal?: string;
			name: string;
			startDate?: string | null;
		}
	): Promise<Sprint>;
	get(userId: string, id: string): Promise<Sprint | null>;
	list(userId: string): Promise<Sprint[]>;
	remove(userId: string, id: string): Promise<boolean>;
	setStatus(
		userId: string,
		id: string,
		status: SprintStatus
	): Promise<Sprint | null>;
	update(
		userId: string,
		id: string,
		patch: {
			endDate?: string | null;
			goal?: string;
			name?: string;
			startDate?: string | null;
		}
	): Promise<Sprint | null>;
}

export interface TaskStore {
	create(
		userId: string,
		input: { sprintId?: string | null; status?: TaskStatus; title: string }
	): Promise<Task>;
	get(userId: string, id: string): Promise<Task | null>;
	getBySeq(userId: string, seq: number): Promise<Task | null>;
	listBacklog(userId: string): Promise<Task[]>;
	listColumn(
		userId: string,
		sprintId: string | null,
		status: TaskStatus
	): Promise<Task[]>;
	move(
		userId: string,
		id: string,
		patch: { position: number; sprintId?: string | null; status: TaskStatus }
	): Promise<Task | null>;
	remove(userId: string, id: string): Promise<boolean>;
	update(
		userId: string,
		id: string,
		patch: { description?: string; title?: string }
	): Promise<Task | null>;
}
