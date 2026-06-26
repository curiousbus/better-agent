import type { AgentClient, RunEvent } from "@better-agent/client";
import {
	createStreamReveal,
	type StreamReveal,
} from "@better-agent/ui/lib/stream-reveal";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";

// Query key for a session's message history, fetched through the Agent SDK
// (token-scoped) rather than the unauthenticated oRPC client.
const messagesKey = (sessionId: string) =>
	["agent", "messages", sessionId] as const;

interface StreamState {
	assistant: ChatMessage;
	reveal: StreamReveal | null;
	revealKind: "text" | "reasoning" | null;
	setDraft: (msgs: ChatMessage[]) => void;
	user: ChatMessage;
}

function emit(state: StreamState) {
	state.setDraft([
		state.user,
		{ ...state.assistant, blocks: [...state.assistant.blocks] },
	]);
}

// Finalize the current text/reasoning run: reveal the rest and stop revealing.
function sealReveal(state: StreamState) {
	if (state.reveal) {
		state.reveal.flush();
		state.reveal = null;
		state.revealKind = null;
	}
}

function pushDelta(
	state: StreamState,
	kind: "text" | "reasoning",
	delta: string
) {
	if (state.revealKind !== kind) {
		sealReveal(state);
		state.assistant.blocks.push({ kind, text: "" });
		state.revealKind = kind;
		state.reveal = createStreamReveal({
			onFrame: ({ text, reasoning }) => {
				const last = state.assistant.blocks.at(-1);
				if (last && last.kind === kind) {
					last.text = kind === "text" ? text : reasoning;
				}
				emit(state);
			},
		});
	}
	if (kind === "text") {
		state.reveal?.pushText(delta);
	} else {
		state.reveal?.pushReasoning(delta);
	}
}

function applyToolResult(
	state: StreamState,
	event: Extract<RunEvent, { type: "tool-result" }>
) {
	state.assistant.blocks = state.assistant.blocks.map((block) =>
		block.kind === "tool" && block.tool.callId === event.callId
			? {
					kind: "tool",
					tool: {
						...block.tool,
						result: event.result,
						isError: event.isError,
						status: event.isError ? "error" : "complete",
					},
				}
			: block
	);
	emit(state);
}

function applyEvent(event: RunEvent, state: StreamState) {
	if (event.type === "text-delta") {
		pushDelta(state, "text", event.delta);
	} else if (event.type === "reasoning-delta") {
		pushDelta(state, "reasoning", event.delta);
	} else if (event.type === "tool-call") {
		sealReveal(state);
		state.assistant.blocks.push({
			kind: "tool",
			tool: {
				callId: event.callId,
				toolName: event.toolName,
				args: event.args,
				isError: false,
				status: "running",
			},
		});
		emit(state);
	} else if (event.type === "tool-result") {
		applyToolResult(state, event);
	} else if (event.type === "error") {
		state.assistant.status = "error";
		state.assistant.errorText = event.message;
		emit(state);
	}
}

interface StreamArgs {
	agentClient: AgentClient;
	assistant: ChatMessage;
	sessionId: string;
	setDraft: (msgs: ChatMessage[]) => void;
	signal: AbortSignal;
	text: string;
	user: ChatMessage;
}

export async function streamPrompt(args: StreamArgs) {
	const state: StreamState = {
		assistant: args.assistant,
		user: args.user,
		setDraft: args.setDraft,
		reveal: null,
		revealKind: null,
	};
	try {
		for await (const event of args.agentClient.stream(args.text, {
			sessionId: args.sessionId,
			signal: args.signal,
		})) {
			applyEvent(event, state);
		}
		sealReveal(state);
	} catch (error) {
		state.reveal?.stop();
		throw error;
	}
}

interface SendArgs {
	abortRef: React.MutableRefObject<AbortController | null>;
	agentClient: AgentClient;
	queryClient: QueryClient;
	sessionId: string;
	setDraft: (msgs: ChatMessage[]) => void;
	setStreaming: (v: boolean) => void;
	streaming: boolean;
}

async function finalizeSend(sessionId: string, args: SendArgs) {
	args.setStreaming(false);
	args.abortRef.current = null;
	await args.queryClient.invalidateQueries({
		queryKey: messagesKey(sessionId),
	});
	args.setDraft([]);
}

async function sendMessage(text: string, args: SendArgs) {
	if (args.sessionId === "" || args.streaming) {
		return;
	}
	const controller = new AbortController();
	args.abortRef.current = controller;
	args.setStreaming(true);
	const user: ChatMessage = {
		id: "draft-user",
		role: "user",
		status: "complete",
		blocks: [{ kind: "text", text }],
	};
	const assistant: ChatMessage = {
		id: "draft-assistant",
		role: "assistant",
		status: "streaming",
		blocks: [],
	};
	args.setDraft([user, assistant]);
	try {
		await streamPrompt({
			agentClient: args.agentClient,
			sessionId: args.sessionId,
			text,
			signal: controller.signal,
			user,
			assistant,
			setDraft: args.setDraft,
		});
	} catch {
		if (!controller.signal.aborted) {
			assistant.status = "error";
			args.setDraft([user, { ...assistant, blocks: [...assistant.blocks] }]);
		}
	} finally {
		await finalizeSend(args.sessionId, args);
	}
}

export function useChat(sessionId: string, agentClient: AgentClient) {
	const queryClient = useQueryClient();
	const history = useQuery({
		queryKey: messagesKey(sessionId),
		queryFn: () => agentClient.listMessages(sessionId),
		enabled: sessionId !== "",
	});
	const [draft, setDraft] = useState<ChatMessage[]>([]);
	const [streaming, setStreaming] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	// Abort an in-flight stream when the session switches or the page unmounts.
	useEffect(() => () => abortRef.current?.abort(), []);

	const messages: ChatMessage[] = [
		...(history.data ?? []).map(toChatMessage),
		...draft,
	];

	const send = (text: string) =>
		sendMessage(text, {
			agentClient,
			sessionId,
			streaming,
			abortRef,
			setStreaming,
			setDraft,
			queryClient,
		});

	const stop = () => {
		abortRef.current?.abort();
		if (sessionId !== "") {
			agentClient.cancel(sessionId).catch(() => undefined);
		}
	};

	return { messages, streaming, send, stop };
}
