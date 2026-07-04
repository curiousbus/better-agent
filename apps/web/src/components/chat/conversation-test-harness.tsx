import { Conversation } from "@better-agent/ui/components/chat/conversation";
import type { AgentClient, MessageHistory } from "@curiousbus/agent-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { expect } from "vitest";

// Shared harness for the Conversation "reply never vanishes" regression tests.

const STAMP = new Date("2026-07-02T00:00:00Z");
export const TICK_MS = 15;
// Mirror production's QueryClient defaults (apps/web/src/utils/orpc.ts): the
// 60s staleTime is load-bearing — it makes naive fetchQuery calls return the
// CACHED pre-turn rows without a network hit.
const PROD_STALE_TIME_MS = 60_000;

export const tick = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export function row(
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

// Production always wires generative UI (chat-view passes GENUI_CHAT_CONFIG),
// which makes renderTree defined — a message with a non-null `structured` then
// renders as a tree INSTEAD of its text. The harness must match, or structured-
// field regressions (e.g. the done event's structured:null wiping the reply)
// are invisible here while breaking prod.
const GENUI_TEST_CONFIG = {
	handlers: {},
	outputSchema: {},
	renderers: {},
	tools: [],
};

export function renderChat(client: AgentClient, sessionId: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: PROD_STALE_TIME_MS },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<Conversation
				agentClient={client}
				generativeUI={GENUI_TEST_CONFIG}
				initialText="hi-question"
				sessionId={sessionId}
			/>
		</QueryClientProvider>
	);
}

export function watchDom(container: Element) {
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

export function assertNeverVanishes(snapshots: string[], marker: string) {
	const first = snapshots.findIndex((s) => s.includes(marker));
	expect(first).toBeGreaterThanOrEqual(0);
	expect(snapshots.slice(first).filter((s) => !s.includes(marker))).toEqual([]);
}
