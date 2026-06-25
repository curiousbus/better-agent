import type { AgentClient, MessageHistory } from "@better-agent/client";
import { createStreamReveal } from "@better-agent/ui/lib/stream-reveal";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

type SessionMessageRow = MessageHistory[number];

export interface ToolInvocation {
	args: unknown;
	callId: string;
	isError: boolean;
	result?: unknown;
	status: "running" | "complete" | "error";
	toolName: string;
}

export interface ChatMessage {
	errorText?: string;
	id: string;
	reasoning: string;
	role: "user" | "assistant" | "system";
	status: "complete" | "streaming" | "error";
	text: string;
	tools: ToolInvocation[];
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

function buildTools(parts: SessionMessageRow["parts"]): ToolInvocation[] {
	const byId = new Map<string, ToolInvocation>();
	const order: string[] = [];
	for (const part of parts) {
		if (part.type === "tool-call") {
			const c = part.content;
			byId.set(c.callId, {
				callId: c.callId,
				toolName: c.toolName,
				args: c.args,
				isError: false,
				status: "running",
			});
			order.push(c.callId);
		} else if (part.type === "tool-result") {
			const c = part.content;
			const inv = byId.get(c.callId);
			if (inv) {
				inv.result = c.result;
				inv.isError = c.isError;
				inv.status = c.isError ? "error" : "complete";
			}
		}
	}
	return order
		.map((id) => byId.get(id))
		.filter((x): x is ToolInvocation => x !== undefined);
}

export function toChatMessage(entry: SessionMessageRow): ChatMessage {
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
		tools: buildTools(entry.parts),
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

function applyEvent(
	event: import("@better-agent/client").RunEvent,
	ctx: {
		assistant: ChatMessage;
		reveal: ReturnType<typeof createStreamReveal>;
		setDraft: (msgs: ChatMessage[]) => void;
		user: ChatMessage;
	}
) {
	const { assistant, reveal, setDraft, user } = ctx;
	if (event.type === "text-delta") {
		reveal.pushText(event.delta);
	} else if (event.type === "reasoning-delta") {
		reveal.pushReasoning(event.delta);
	} else if (event.type === "tool-call") {
		assistant.tools = [
			...assistant.tools,
			{
				callId: event.callId,
				toolName: event.toolName,
				args: event.args,
				isError: false,
				status: "running" as const,
			},
		];
		setDraft([user, { ...assistant }]);
	} else if (event.type === "tool-result") {
		assistant.tools = assistant.tools.map((t) =>
			t.callId === event.callId
				? {
						...t,
						result: event.result,
						isError: event.isError,
						status: event.isError ? ("error" as const) : ("complete" as const),
					}
				: t
		);
		setDraft([user, { ...assistant }]);
	} else if (event.type === "error") {
		assistant.status = "error";
		assistant.errorText = event.message;
		setDraft([user, { ...assistant }]);
	}
}

export async function streamPrompt(args: StreamArgs) {
	const { agentClient, sessionId, text, signal, user, assistant, setDraft } =
		args;
	// Reveal buffered deltas one chunk per frame (steady typing cadence) instead
	// of a setState per network token, which is what made the output choppy.
	const reveal = createStreamReveal({
		onFrame: ({ text: revealedText, reasoning }) => {
			assistant.text = revealedText;
			assistant.reasoning = reasoning;
			setDraft([user, { ...assistant }]);
		},
	});
	try {
		for await (const event of agentClient.stream(text, { sessionId, signal })) {
			applyEvent(event, { assistant, reveal, setDraft, user });
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
		tools: [],
	};
	const assistant: ChatMessage = {
		id: "draft-assistant",
		role: "assistant",
		text: "",
		reasoning: "",
		status: "streaming",
		tools: [],
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
		if (sessionId !== "") {
			agentClient.cancel(sessionId).catch(() => undefined);
		}
	};

	return { messages, streaming, send, stop };
}
