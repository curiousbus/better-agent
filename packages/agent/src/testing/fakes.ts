import type {
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	SessionStore,
} from "../ports";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "../provider/types";
import type { Summarizer } from "../session/compaction";
import type { Titler } from "../session/titler";
import type { Message, MessagePart, Session } from "../session/types";

export function createFakeCatalogStore(): ProviderCatalogStore {
	let entries: ProviderCatalogEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		list() {
			return Promise.resolve(entries);
		},
		get(providerId) {
			return Promise.resolve(
				entries.find((e) => e.providerId === providerId) ?? null
			);
		},
	};
}

export function createFakeModelStore(): ModelCacheStore {
	let entries: ModelEntry[] = [];
	return {
		replaceAll(next) {
			entries = next;
			return Promise.resolve();
		},
		listByProvider(providerId) {
			return Promise.resolve(
				entries.filter((e) => e.providerId === providerId)
			);
		},
		get(providerId, modelId) {
			return Promise.resolve(
				entries.find(
					(e) => e.providerId === providerId && e.modelId === modelId
				) ?? null
			);
		},
	};
}

export function createFakeCredentialStore(
	seed: ProviderCredential[] = []
): ProviderCredentialStore {
	const map = new Map(seed.map((c) => [c.providerId, c]));
	return {
		upsert(input) {
			map.set(input.providerId, input);
			return Promise.resolve();
		},
		delete(providerId) {
			map.delete(providerId);
			return Promise.resolve();
		},
		listMasked() {
			return Promise.resolve(
				[...map.values()].map(({ apiKey, ...rest }) => ({
					...rest,
					last4: apiKey.slice(-4),
				}))
			);
		},
		get(providerId) {
			return Promise.resolve(map.get(providerId) ?? null);
		},
	};
}

function makeSessionMutators(
	map: Map<string, Session>
): Pick<SessionStore, "setStatus" | "setTitle" | "setSummary"> {
	return {
		setStatus(id, status) {
			const session = map.get(id);
			if (session) {
				session.status = status;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
		setTitle(id, title) {
			const session = map.get(id);
			if (session) {
				session.title = title;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
		setSummary(id, summary, compactedThroughSeq) {
			const session = map.get(id);
			if (session) {
				session.summary = summary;
				session.compactedThroughSeq = compactedThroughSeq;
				session.updatedAt = new Date();
			}
			return Promise.resolve();
		},
	};
}

export function createFakeSessionStore(): SessionStore {
	const map = new Map<string, Session>();
	return {
		create(input) {
			const now = new Date();
			const session: Session = {
				id: crypto.randomUUID(),
				agentId: input.agentId,
				userId: input.userId ?? null,
				title: null,
				status: "active",
				summary: null,
				compactedThroughSeq: null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(session.id, session);
			return Promise.resolve(session);
		},
		get(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...map.values()]);
		},
		listByAgent(agentId) {
			return Promise.resolve(
				[...map.values()].filter((s) => s.agentId === agentId)
			);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...map.values()].filter((s) => s.userId === userId)
			);
		},
		...makeSessionMutators(map),
	};
}

function groupMessagesWithParts(
	messages: Message[],
	parts: MessagePart[],
	sessionId: string
) {
	return messages
		.filter((message) => message.sessionId === sessionId)
		.sort((a, b) => a.seq - b.seq)
		.map((message) => ({
			message,
			parts: parts
				.filter((part) => part.messageId === message.id)
				.sort((a, b) => a.seq - b.seq),
		}));
}

interface MessageStoreState {
	messages: Message[];
	parts: MessagePart[];
}

function makeMessageOps(
	state: MessageStoreState
): Pick<MessageStore, "createMessage" | "appendPart"> {
	return {
		createMessage(input) {
			const now = new Date();
			const seq = state.messages.filter(
				(m) => m.sessionId === input.sessionId
			).length;
			const message: Message = {
				id: crypto.randomUUID(),
				sessionId: input.sessionId,
				role: input.role,
				seq,
				status: input.status,
				providerId: input.providerId,
				modelId: input.modelId,
				usage: null,
				finishReason: null,
				error: null,
				createdAt: now,
				updatedAt: now,
			};
			state.messages.push(message);
			return Promise.resolve(message);
		},
		appendPart(input) {
			const now = new Date();
			const seq = state.parts.filter(
				(p) => p.messageId === input.messageId
			).length;
			// type と content はドメインで対応するが入力は別フィールド；DB 境界と同様に一度だけアサート。
			const part = {
				id: crypto.randomUUID(),
				messageId: input.messageId,
				seq,
				type: input.type,
				content: input.content,
				status: input.status,
				createdAt: now,
				updatedAt: now,
			} as MessagePart;
			state.parts.push(part);
			return Promise.resolve(part);
		},
	};
}

export function createFakeMessageStore(): MessageStore {
	const state: MessageStoreState = {
		messages: [],
		parts: [],
	};
	return {
		...makeMessageOps(state),
		updateMessage(id, patch) {
			const message = state.messages.find((m) => m.id === id);
			if (!message) {
				return Promise.resolve(null);
			}
			Object.assign(message, patch, { updatedAt: new Date() });
			return Promise.resolve(message);
		},
		updatePart(id, patch) {
			const part = state.parts.find((p) => p.id === id);
			if (!part) {
				return Promise.resolve(null);
			}
			Object.assign(part, patch, { updatedAt: new Date() });
			return Promise.resolve(part);
		},
		listWithParts(sessionId) {
			return Promise.resolve(
				groupMessagesWithParts(state.messages, state.parts, sessionId)
			);
		},
	};
}

export function createFakeSummarizer(canned = "summary"): Summarizer & {
	calls: { providerId: string; modelId: string; prompt: string }[];
} {
	const calls: { providerId: string; modelId: string; prompt: string }[] = [];
	return {
		calls,
		summarize(input) {
			calls.push(input);
			return Promise.resolve(canned);
		},
	};
}

export function createFakeTitler(
	canned = "A Title"
): Titler & { calls: number } {
	const state = { calls: 0 };
	return {
		title() {
			state.calls++;
			return Promise.resolve(canned);
		},
		get calls() {
			return state.calls;
		},
	};
}
