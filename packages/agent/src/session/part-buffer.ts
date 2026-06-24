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

export function createPartBuffer(
	messageStore: MessageStore,
	messageId: string,
	type: "text" | "reasoning"
) {
	let buf = "";
	let partId: string | null = null;
	let lastWrite = 0;
	return {
		async append(delta: string): Promise<void> {
			buf += delta;
			if (partId === null) {
				const part = await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status: "streaming",
				});
				partId = part.id;
				lastWrite = Date.now();
				return;
			}
			if (Date.now() - lastWrite >= PERSIST_THROTTLE_MS) {
				await messageStore.updatePart(partId, { content: { text: buf } });
				lastWrite = Date.now();
			}
		},
		async flush(status: PartStatus): Promise<void> {
			if (buf.length === 0) {
				return;
			}
			if (partId === null) {
				await messageStore.appendPart({
					messageId,
					type,
					content: { text: buf },
					status,
				});
				return;
			}
			await messageStore.updatePart(partId, {
				content: { text: buf },
				status,
			});
		},
	};
}
