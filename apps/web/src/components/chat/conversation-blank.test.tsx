// @vitest-environment jsdom
import { Conversation } from "@better-agent/ui/components/chat/conversation";
import type { AgentClient, MessageHistory } from "@curiousbus/agent-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

// Reproduction harness for "chat clears mid-turn, reappears at done": renders
// the REAL Conversation over a realistic tool-using turn (text → tool-call →
// execution gap → tool-result → text → done) and records a DOM snapshot on
// every mutation. Once the user's message is visible it must never vanish.

const STAMP = new Date("2026-07-02T00:00:00Z");
const TICK_MS = 15;

const tick = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function row(
	id: string,
	role: "user" | "assistant",
	status: string,
	seq: number,
	text: string
): MessageHistory[number] {
	return {
		message: {
			id,
			sessionId: "s1",
			role,
			seq,
			status,
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: STAMP,
			updatedAt: STAMP,
		},
		parts: [{ id: `p-${id}`, type: "text", content: { text } }],
	} as unknown as MessageHistory[number];
}

// Server-realistic history: rows exist (streaming) DURING the turn.
function fakeClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	return {
		listMessages: () => {
			if (state.phase === "idle") {
				return Promise.resolve([]);
			}
			const assistantStatus = state.phase === "done" ? "complete" : "streaming";
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				row(
					"a1",
					"assistant",
					assistantStatus,
					2,
					"let me check — here is the answer"
				),
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "let me check" };
			await tick(TICK_MS);
			yield {
				type: "tool-call",
				callId: "c1",
				toolName: "TWITTER_SEARCH",
				args: { q: "x" },
			};
			// Tool executing on the server — the suspicious window.
			await tick(TICK_MS * 4);
			yield {
				type: "tool-result",
				callId: "c1",
				result: "found things",
				isError: false,
			};
			await tick(TICK_MS);
			yield { type: "text-delta", delta: " — here is the answer" };
			await tick(TICK_MS * 3);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
		uploadAttachment: () => Promise.reject(new Error("not in test")),
		getAttachment: () => Promise.reject(new Error("not in test")),
	} as unknown as AgentClient;
}

// SSE dies right after the text, but the DETACHED server turn keeps running
// and completes later. The draft must stay on screen the whole time — no
// clear-then-reappear window.
function dyingClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	const SERVER_FINISH_MS = 2500;
	return {
		listMessages: () => {
			if (state.phase === "idle") {
				return Promise.resolve([]);
			}
			if (state.phase === "done") {
				return Promise.resolve([
					row("u1", "user", "complete", 1, "hi-question"),
					row("a1", "assistant", "complete", 2, "OK-marker plus more detail"),
				]);
			}
			// Parts not flushed yet while the detached turn is still running.
			return Promise.resolve([
				row("u1", "user", "complete", 1, "hi-question"),
				{
					...row("a1", "assistant", "streaming", 2, ""),
					parts: [],
				} as unknown as ReturnType<typeof row>,
			]);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker plus" };
			// Give the typewriter reveal time to paint the marker before death.
			await tick(400);
			// Server keeps going after the client stream dies.
			setTimeout(() => {
				state.phase = "done";
			}, SERVER_FINISH_MS);
			throw new Error("SSE connection lost");
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

// Mirror production's QueryClient defaults (apps/web/src/utils/orpc.ts): the
// 60s global staleTime is load-bearing — it makes naive fetchQuery calls
// return CACHED pre-turn rows without a network hit.
const PROD_STALE_TIME_MS = 60_000;

function renderChat(client: AgentClient, sessionId: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: PROD_STALE_TIME_MS },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<Conversation
				agentClient={client}
				initialText="hi-question"
				sessionId={sessionId}
			/>
		</QueryClientProvider>
	);
}

function watchDom(container: Element) {
	const snapshots: string[] = [];
	const observer = new MutationObserver(() => {
		snapshots.push(container.textContent ?? "");
	});
	observer.observe(container, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	return { snapshots, stop: () => observer.disconnect() };
}

function assertNeverVanishes(snapshots: string[], marker: string) {
	const first = snapshots.findIndex((s) => s.includes(marker));
	expect(first).toBeGreaterThanOrEqual(0);
	expect(snapshots.slice(first).filter((s) => !s.includes(marker))).toEqual([]);
}

// SECOND turn in an existing session: while streaming, the cached history is
// the PRE-turn view (trailing = the PREVIOUS completed assistant). The new
// exchange must never vanish against that stale view at completion.
function secondTurnClient(state: {
	phase: "idle" | "running" | "done";
}): AgentClient {
	const FETCH_DELAY_MS = 120;
	const prior = [
		row("u0", "user", "complete", 1, "old-question"),
		row("a0", "assistant", "complete", 2, "old-answer"),
	];
	return {
		listMessages: () => {
			if (state.phase !== "done") {
				return Promise.resolve(prior);
			}
			// Slow post-turn fetch: widens the window where stale history could
			// wrongly clear the draft.
			return new Promise((resolve) =>
				setTimeout(
					() =>
						resolve([
							...prior,
							row("u1", "user", "complete", 3, "hi-question"),
							row("a1", "assistant", "complete", 4, "OK-marker plus more"),
						]),
					FETCH_DELAY_MS
				)
			);
		},
		async *stream() {
			state.phase = "running";
			yield { type: "text-delta", delta: "OK-marker plus" };
			// Let the typewriter reveal paint the marker.
			await tick(400);
			state.phase = "done";
			yield { type: "done", usage: null, finishReason: "stop" };
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

it("second turn never vanishes against stale pre-turn history", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(secondTurnClient(state), "s-second");
	const dom = watchDom(container);

	await waitFor(
		() => {
			expect(state.phase).toBe("done");
		},
		{ timeout: 6000 }
	);
	await act(async () => {
		await tick(600);
	});
	dom.stop();

	assertNeverVanishes(dom.snapshots, "hi-question");
	assertNeverVanishes(dom.snapshots, "OK-marker");
	expect(container.textContent).toContain("old-answer");
	expect(container.textContent).toContain("OK-marker plus more");
});

it("keeps the draft when the stream dies while the server turn continues", {
	timeout: 10_000,
}, async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(dyingClient(state), "s-dying");
	const dom = watchDom(container);

	// Wait until the server-side turn completed AND the polling swap settled.
	await waitFor(
		() => {
			expect(state.phase).toBe("done");
		},
		{ timeout: 6000 }
	);
	await act(async () => {
		await tick(2000);
	});
	dom.stop();

	assertNeverVanishes(dom.snapshots, "hi-question");
	// The partially-revealed reply must survive the disconnect window too.
	assertNeverVanishes(dom.snapshots, "OK-marker");
	// And the final view renders the persisted rows.
	expect(container.textContent).toContain("OK-marker plus more detail");
});

it("chat content never vanishes between first paint and completion", async () => {
	const state = { phase: "idle" as "idle" | "running" | "done" };
	const { container } = renderChat(fakeClient(state), "s1");
	const dom = watchDom(container);

	// initialText auto-sends after mount; wait for the turn to fully finish.
	await waitFor(
		() => {
			expect(state.phase).toBe("done");
		},
		{ timeout: 5000 }
	);
	// Let finalize (fetch + draft clear) and any trailing renders settle.
	await act(async () => {
		await tick(TICK_MS * 4);
	});
	dom.stop();

	assertNeverVanishes(dom.snapshots, "hi-question");
	// The empty-state copy must never appear once content exists.
	const first = dom.snapshots.findIndex((s) => s.includes("hi-question"));
	expect(
		dom.snapshots
			.slice(first)
			.filter((s) => s.includes("Start the conversation"))
	).toEqual([]);
});
