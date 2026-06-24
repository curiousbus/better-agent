import type { MessageStore } from "../ports";
import type { PartStatus } from "./types";

const PERSIST_THROTTLE_MS = 250;

/**
 * Accumulates one part's deltas and persists incrementally: the part is created
 * on the first delta (status "streaming"), updated in place at most once per
 * PERSIST_THROTTLE_MS, and finalized on flush. A mid-stream crash therefore
 * leaves the partial text durable rather than losing the whole message.
 */
export type PartBuf = ReturnType<typeof createPartBuffer>;

interface BufState {
	buf: string;
	lastWrite: number;
	partId: string | null;
}

interface AppendCtx {
	messageId: string;
	messageStore: MessageStore;
	type: "text" | "reasoning";
}

async function appendDelta(
	delta: string,
	s: BufState,
	ctx: AppendCtx
): Promise<void> {
	s.buf += delta;
	if (s.partId === null) {
		const part = await ctx.messageStore.appendPart({
			messageId: ctx.messageId,
			type: ctx.type,
			content: { text: s.buf },
			status: "streaming",
		});
		s.partId = part.id;
		s.lastWrite = Date.now();
		return;
	}
	if (Date.now() - s.lastWrite >= PERSIST_THROTTLE_MS) {
		await ctx.messageStore.updatePart(s.partId, { content: { text: s.buf } });
		s.lastWrite = Date.now();
	}
}

export function createPartBuffer(
	messageStore: MessageStore,
	messageId: string,
	type: "text" | "reasoning"
) {
	const s: BufState = { buf: "", partId: null, lastWrite: 0 };
	const ctx: AppendCtx = { messageStore, messageId, type };
	return {
		append(delta: string): Promise<void> {
			return appendDelta(delta, s, ctx);
		},
		async flush(status: PartStatus): Promise<void> {
			if (s.buf.length === 0) {
				return;
			}
			if (s.partId === null) {
				await messageStore.appendPart({
					messageId,
					type,
					content: { text: s.buf },
					status,
				});
				return;
			}
			await messageStore.updatePart(s.partId, {
				content: { text: s.buf },
				status,
			});
		},
		async finishStep(): Promise<void> {
			if (s.partId === null || s.buf.length === 0) {
				return;
			}
			await messageStore.updatePart(s.partId, {
				content: { text: s.buf },
				status: "complete",
			});
			s.partId = null;
			s.buf = "";
			s.lastWrite = 0;
		},
	};
}
