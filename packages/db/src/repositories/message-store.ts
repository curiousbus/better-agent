import type { MessageStore } from "@better-agent/agent/ports";
import type { Message, MessagePart } from "@better-agent/agent/session/types";
import { eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type MessageRow = typeof schema.messages.$inferSelect;
type PartRow = typeof schema.messageParts.$inferSelect;

const NO_SEQ = -1;

function toMessage(row: MessageRow): Message {
	return {
		id: row.id,
		sessionId: row.sessionId,
		role: row.role,
		seq: row.seq,
		status: row.status,
		providerId: row.providerId,
		modelId: row.modelId,
		usage: row.usage ?? null,
		finishReason: row.finishReason ?? null,
		error: row.error ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// `type` 与 `content` 是两列独立存储，DB 无法表达二者关联，故在边界做一次断言。
function toMessagePart(row: PartRow): MessagePart {
	return {
		id: row.id,
		messageId: row.messageId,
		seq: row.seq,
		type: row.type,
		content: row.content,
		status: row.status,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	} as MessagePart;
}

function nextSeq(seqs: number[]): number {
	return seqs.reduce((max, seq) => (seq > max ? seq : max), NO_SEQ) + 1;
}

function makeCreateMessage(db: Db): MessageStore["createMessage"] {
	return (input) =>
		db.transaction(async (tx) => {
			const existing = await tx
				.select({ seq: schema.messages.seq })
				.from(schema.messages)
				.where(eq(schema.messages.sessionId, input.sessionId));
			const rows = await tx
				.insert(schema.messages)
				.values({ ...input, seq: nextSeq(existing.map((r) => r.seq)) })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create message");
			}
			return toMessage(row);
		});
}

function makeAppendPart(db: Db): MessageStore["appendPart"] {
	return (input) =>
		db.transaction(async (tx) => {
			const existing = await tx
				.select({ seq: schema.messageParts.seq })
				.from(schema.messageParts)
				.where(eq(schema.messageParts.messageId, input.messageId));
			const rows = await tx
				.insert(schema.messageParts)
				.values({ ...input, seq: nextSeq(existing.map((r) => r.seq)) })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to append message part");
			}
			return toMessagePart(row);
		});
}

async function makeListWithParts(
	db: Db,
	sessionId: string
): Promise<Awaited<ReturnType<MessageStore["listWithParts"]>>> {
	const messageRows = await db
		.select()
		.from(schema.messages)
		.where(eq(schema.messages.sessionId, sessionId))
		.orderBy(schema.messages.seq);
	if (messageRows.length === 0) {
		return [];
	}
	const partRows = await db
		.select()
		.from(schema.messageParts)
		.where(
			inArray(
				schema.messageParts.messageId,
				messageRows.map((m) => m.id)
			)
		)
		.orderBy(schema.messageParts.seq);
	return messageRows.map((message) => ({
		message: toMessage(message),
		parts: partRows
			.filter((part) => part.messageId === message.id)
			.map(toMessagePart),
	}));
}

export function createMessageStore(db: Db): MessageStore {
	return {
		createMessage: makeCreateMessage(db),
		async updateMessage(id, patch) {
			const rows = await db
				.update(schema.messages)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.messages.id, id))
				.returning();
			const row = rows[0];
			return row ? toMessage(row) : null;
		},
		appendPart: makeAppendPart(db),
		async updatePart(id, patch) {
			const rows = await db
				.update(schema.messageParts)
				.set({ ...patch, updatedAt: new Date() })
				.where(eq(schema.messageParts.id, id))
				.returning();
			const row = rows[0];
			return row ? toMessagePart(row) : null;
		},
		listWithParts: (sessionId) => makeListWithParts(db, sessionId),
	};
}
