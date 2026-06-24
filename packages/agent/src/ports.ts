import type { AgentConfig, AgentInput } from "./agent/types";
import type { RefreshTokenRecord, User } from "./auth/types";
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
		input: AgentInput & { tokenHash: string; token?: string }
	): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	findByTokenHash(tokenHash: string): Promise<AgentConfig | null>;
	get(id: string): Promise<AgentConfig | null>;
	/** The agent's current plaintext token, decrypted from storage (null if none). */
	getToken(id: string): Promise<string | null>;
	list(): Promise<AgentConfig[]>;
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

export interface UserStore {
	findByEmail(email: string): Promise<User | null>;
	findById(id: string): Promise<User | null>;
	findOrCreate(email: string): Promise<User>;
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
	}): Promise<void>;
	find(tokenHash: string): Promise<RefreshTokenRecord | null>;
	revoke(id: string): Promise<void>;
	revokeAllForUser(userId: string): Promise<void>;
}

export interface EmailSender {
	sendMagicLink(input: { email: string; url: string }): Promise<void>;
}
