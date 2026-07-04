// @vitest-environment jsdom
import { Conversation } from "@better-agent/ui/components/chat/conversation";
import type { AgentClient } from "@curiousbus/agent-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { GENUI_CHAT_CONFIG } from "../../genui/config";

const tick = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

// A UI tree the manifest can render: a Heading with a marker we assert on.
const UI_TREE = {
	root: {
		id: "n1",
		type: "Stack",
		props: {},
		children: [{ id: "n2", type: "Heading", props: { text: "GENUI-MARKER" } }],
	},
};

// Emits a structured turn (StructuredOutput), then persists it in history as a
// StructuredOutput tool-call part so both the live draft and the swapped-in
// history row must render the component tree — never fall back to markdown.
function msg(id: string, role: string, seq: number, parts: unknown[]) {
	return {
		message: {
			id,
			sessionId: "s1",
			role,
			seq,
			status: "complete",
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		parts,
	};
}

// The persisted turn: the assistant row carries the UI tree as a
// StructuredOutput tool-call part (what buildBlocks lifts into `structured`).
function persistedTurn() {
	return [
		msg("u1", "user", 1, [
			{ id: "pu", type: "text", content: { text: "show a card" } },
		]),
		msg("a1", "assistant", 2, [
			{
				id: "pa",
				type: "tool-call",
				content: { callId: "c1", toolName: "StructuredOutput", args: UI_TREE },
			},
		]),
	];
}

function genuiClient(state: { phase: "idle" | "done" }): AgentClient {
	return {
		listMessages: () =>
			Promise.resolve(state.phase === "idle" ? [] : persistedTurn()),
		async *stream() {
			yield { type: "structured-delta", partial: UI_TREE };
			await tick(20);
			state.phase = "done";
			yield {
				type: "done",
				usage: null,
				finishReason: "stop",
				structured: UI_TREE,
			};
		},
		cancel: () => Promise.resolve(),
	} as unknown as AgentClient;
}

it("renders the generative UI tree, not markdown, through completion", async () => {
	const state = { phase: "idle" as "idle" | "done" };
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<Conversation
				agentClient={genuiClient(state)}
				generativeUI={GENUI_CHAT_CONFIG}
				initialGenui
				initialText="show a card"
				sessionId="s-genui"
			/>
		</QueryClientProvider>
	);

	// The heading text appears while streaming (draft) …
	await waitFor(() => expect(container.textContent).toContain("GENUI-MARKER"), {
		timeout: 4000,
	});
	// … and survives the draft→history swap.
	await waitFor(() => expect(state.phase).toBe("done"), { timeout: 4000 });
	await act(async () => {
		await tick(400);
	});
	expect(container.textContent).toContain("GENUI-MARKER");
	// It must render as a heading element, not as literal markdown text.
	expect(container.querySelector("h2")?.textContent).toBe("GENUI-MARKER");
});
