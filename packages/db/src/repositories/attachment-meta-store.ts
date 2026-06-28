import { eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Attachment metadata row, including the internal object-storage key. */
export type AttachmentMeta = typeof schema.attachments.$inferSelect;

export interface AttachmentMetaStore {
	getById(id: string): Promise<AttachmentMeta | null>;
	insert(input: {
		mime: string;
		name: string;
		r2Key: string;
		sessionId: string;
		size: number;
	}): Promise<AttachmentMeta>;
	linkToMessage(ids: string[], messageId: string): Promise<void>;
	listByMessage(messageId: string): Promise<AttachmentMeta[]>;
}

export function createAttachmentMetaStore(db: Db): AttachmentMetaStore {
	return {
		async insert(input) {
			const rows = await db
				.insert(schema.attachments)
				.values({
					sessionId: input.sessionId,
					r2Key: input.r2Key,
					mime: input.mime,
					name: input.name,
					size: input.size,
				})
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert attachment");
			}
			return row;
		},
		async getById(id) {
			const rows = await db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.limit(1);
			return rows[0] ?? null;
		},
		async linkToMessage(ids, messageId) {
			if (ids.length === 0) {
				return;
			}
			await db
				.update(schema.attachments)
				.set({ messageId })
				.where(inArray(schema.attachments.id, ids));
		},
		listByMessage(messageId) {
			return db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.messageId, messageId));
		},
	};
}
