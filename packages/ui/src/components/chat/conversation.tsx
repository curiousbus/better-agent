import {
	GenerativeUI,
	type NodeProps,
} from "@better-agent/ui/components/genui/generative-ui";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import type {
	AgentClient,
	ClientToolDef,
	UIAction,
} from "@curiousbus/agent-client";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChatMessage } from "./chat-blocks";
import { ChatComposer } from "./chat-composer";
import { type ChatAvatars, ChatRow } from "./chat-row";
import { RevealText } from "./reveal-text";
import { useChat } from "./use-chat";

/** Generative-UI wiring an app injects: its component renderers + schema/tools
 * for the agent, and local handlers for client-target actions. */
export interface GenerativeUIChatConfig {
	handlers: Record<string, (payload: unknown) => void>;
	outputSchema: Record<string, unknown>;
	renderers: Record<string, ComponentType<NodeProps>>;
	tools: ClientToolDef[];
}

function EmptyMessages() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<RevealText>
				<p className="t-stagger-line t-stagger-line--1 font-medium text-sm">
					Start the conversation
				</p>
				<p className="t-stagger-line t-stagger-line--2 text-muted-foreground text-sm">
					Send a message to begin.
				</p>
			</RevealText>
		</div>
	);
}

function ChatScroller({
	messages,
	agentClient,
	renderTree,
	avatars,
}: {
	messages: ChatMessage[];
	agentClient: AgentClient;
	renderTree?: (tree: unknown) => ReactNode;
	avatars?: ChatAvatars;
}) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{messages.length === 0 ? (
							<EmptyMessages />
						) : (
							messages.map((message) => (
								// No scrollAnchor: anchoring a new turn to the top inserts a
								// spacer below it and fights autoScroll — follow-bottom then
								// scrolls into that BLANK spacer while text streams. Plain
								// follow-bottom is the behavior users expect.
								<MessageScrollerItem key={message.id}>
									<ChatRow
										agentClient={agentClient}
										avatars={avatars}
										message={message}
										renderTree={renderTree}
									/>
								</MessageScrollerItem>
							))
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

// Send the first message once the chat mounts. Defer it: a transient
// mount/unmount during the composer→chat slide (or a dev double-invoke) cancels
// the stale schedule via cleanup instead of aborting an already-started stream —
// so the send fires exactly once, after things settle, and is never lost.
function useInitialSend(
	initialText: string | undefined,
	send: (text: string) => void
) {
	const sendRef = useRef(send);
	useLayoutEffect(() => {
		sendRef.current = send;
	});
	useEffect(() => {
		const id = initialText
			? setTimeout(() => sendRef.current(initialText), 0)
			: undefined;
		return () => {
			if (id !== undefined) {
				clearTimeout(id);
			}
		};
	}, [initialText]);
}

// Build the assistant-tree renderer (and its action router) for a chat, or
// undefined when the app didn't wire generative UI. target:"client" actions run
// a local handler; target:"agent" actions send a follow-up turn that re-renders.
function buildRenderTree(
	generativeUI: GenerativeUIChatConfig | undefined,
	send: (text: string) => void
): ((tree: unknown) => ReactNode) | undefined {
	const onAction = (action: UIAction) => {
		if (action.target === "client") {
			generativeUI?.handlers[action.intent]?.(action.payload);
		} else {
			send(
				`[ui-event] intent=${action.intent} payload=${JSON.stringify(action.payload ?? null)}`
			);
		}
	};
	return generativeUI
		? (tree: unknown) => (
				<GenerativeUI
					onAction={onAction}
					renderers={generativeUI.renderers}
					tree={tree}
				/>
			)
		: undefined;
}

export function Conversation({
	sessionId,
	agentClient,
	initialText,
	initialGenui,
	generativeUI,
	avatars,
}: {
	sessionId: string;
	agentClient: AgentClient;
	initialText?: string;
	initialGenui?: boolean;
	generativeUI?: GenerativeUIChatConfig;
	avatars?: ChatAvatars;
}) {
	// Start in the genui mode chosen on the landing composer, so the FIRST message
	// (sent via initialText before the in-chat toggle is reachable) honors it.
	const [genuiOn, setGenuiOn] = useState(initialGenui === true);
	const genuiConfig =
		generativeUI && genuiOn
			? { outputSchema: generativeUI.outputSchema, tools: generativeUI.tools }
			: undefined;
	const { messages, streaming, send, stop } = useChat(
		sessionId,
		agentClient,
		genuiConfig
	);
	useInitialSend(initialText, send);
	const renderTree = buildRenderTree(generativeUI, send);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatScroller
				agentClient={agentClient}
				avatars={avatars}
				messages={messages}
				renderTree={renderTree}
			/>
			<ChatComposer
				agentClient={agentClient}
				genuiActive={genuiOn}
				genuiAvailable={generativeUI !== undefined}
				onSend={send}
				onStop={stop}
				onToggleGenui={() => setGenuiOn((v) => !v)}
				sessionId={sessionId}
				streaming={streaming}
			/>
		</div>
	);
}
