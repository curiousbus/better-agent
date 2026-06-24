import { SessionPicker } from "@better-agent/ui/components/chat/session-picker";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { XIcon } from "lucide-react";
import { useState } from "react";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";

interface WebComposerProps {
	agent: AgentRow;
	onClose: () => void;
	onSend: (text: string) => Promise<void>;
	onSessionSelect: (sessionId: string) => void;
	sending: boolean;
	sessions: UserSessionRow[];
}

function ComposerHeader({
	agent,
	sessions,
	onClose,
	onSessionSelect,
}: {
	agent: AgentRow;
	sessions: UserSessionRow[];
	onClose: () => void;
	onSessionSelect: (sessionId: string) => void;
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="truncate font-medium text-sm">{agent.name}</span>
				<span className="hidden truncate font-mono text-muted-foreground text-xs sm:inline">
					{agent.providerId}/{agent.modelId}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<SessionPicker
					onChange={onSessionSelect}
					sessions={sessions}
					value=""
				/>
				<button
					aria-label="Close"
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onClose}
					type="button"
				>
					<XIcon className="size-4" />
				</button>
			</div>
		</header>
	);
}

function ComposerInput({
	agentName,
	text,
	sending,
	onTextChange,
	onSubmit,
}: {
	agentName: string;
	text: string;
	sending: boolean;
	onTextChange: (v: string) => void;
	onSubmit: () => void;
}) {
	return (
		<div className="flex flex-1 items-center justify-center px-4 py-8">
			<div className="w-full max-w-2xl">
				<p className="mb-4 text-center font-medium text-lg">
					Chat with {agentName}
				</p>
				<PromptInput
					className="rounded-2xl border bg-background p-2 shadow-sm"
					onSubmit={onSubmit}
				>
					<PromptInputTextarea
						disabled={sending}
						onChange={onTextChange}
						onSubmit={onSubmit}
						placeholder="Send a message to start a session…"
						value={text}
					/>
					<PromptInputToolbar>
						<PromptInputTools />
						<PromptInputSubmit onStop={() => undefined} status="idle" />
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}

export function WebComposer({
	agent,
	sessions,
	onClose,
	onSend,
	onSessionSelect,
	sending,
}: WebComposerProps) {
	const [text, setText] = useState("");

	const handleSubmit = async () => {
		const trimmed = text.trim();
		if (trimmed === "" || sending) {
			return;
		}
		setText("");
		await onSend(trimmed);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ComposerHeader
				agent={agent}
				onClose={onClose}
				onSessionSelect={onSessionSelect}
				sessions={sessions}
			/>
			<ComposerInput
				agentName={agent.name}
				onSubmit={handleSubmit}
				onTextChange={setText}
				sending={sending}
				text={text}
			/>
		</div>
	);
}
