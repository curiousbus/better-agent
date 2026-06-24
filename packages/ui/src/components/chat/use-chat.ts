import type { AgentClient, MessageHistory } from "@better-agent/client";
import { createStreamReveal } from "@better-agent/ui/lib/stream-reveal";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

type SessionMessageRow = MessageHistory[number];

export interface ChatMessage {
	id: string;
	reasoning: string;
	role: "user" | "assistant" | "system";
	status: "complete" | "streaming" | "error";
	text: string;
}

// Query key for a session's message history, fetched through the Agent SDK
// (token-scoped) rather than the unauthenticated oRPC client.
const messagesKey = (sessionId: string) =>
	["agent", "messages", sessionId] as const;

function partStatus(status: SessionMessageRow["message"]["status"]) {
	if (status === "complete") {
		return "complete" as const;
	}
	if (status === "error") {
		return "error" as const;
	}
	if (status === "aborted") {
		return "complete" as const;
	}
	return "streaming" as const;
}

function toChatMessage(entry: SessionMessageRow): ChatMessage {
	let text = "";
	let reasoning = "";
	for (const part of entry.parts) {
		if (part.type === "text") {
			text += part.content.text;
		} else if (part.type === "reasoning") {
			reasoning += part.content.text;
		}
	}
	return {
		id: entry.message.id,
		role: entry.message.role,
		text,
		reasoning,
		status: partStatus(entry.message.status),
	};
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

async function streamPrompt(args: StreamArgs) {
	const { agentClient, sessionId, text, signal, user, assistant, setDraft } =
		args;
	// Reveal buffered deltas one chunk per frame (steady typing cadence) instead
	// of a setState per network token, which is what made the output choppy.
	const reveal = createStreamReveal({
		onFrame: ({ text: revealedText, reasoning }) =>
			setDraft([user, { ...assistant, text: revealedText, reasoning }]),
	});
	try {
		for await (const event of agentClient.stream(text, { sessionId, signal })) {
			if (event.type === "text-delta") {
				reveal.pushText(event.delta);
			} else if (event.type === "reasoning-delta") {
				reveal.pushReasoning(event.delta);
			} else if (event.type === "error") {
				assistant.status = "error";
			}
		}
		reveal.flush();
	} catch (error) {
		reveal.stop();
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
		text,
		reasoning: "",
		status: "complete",
	};
	const assistant: ChatMessage = {
		id: "draft-assistant",
		role: "assistant",
		text: "",
		reasoning: "",
		status: "streaming",
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
			args.setDraft([user, { ...assistant }]);
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
	};

	return { messages, streaming, send, stop };
}
