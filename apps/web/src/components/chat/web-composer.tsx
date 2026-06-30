import { Button } from "@better-agent/ui/components/button";
import { SessionPicker } from "@better-agent/ui/components/chat/session-picker";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { cn } from "@better-agent/ui/lib/utils";
import { SparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { AgentRow, UserSessionRow } from "@/utils/api-types";

interface WebComposerProps {
	agent: AgentRow;
	genuiActive?: boolean;
	onClose: () => void;
	onSend: (text: string) => Promise<void>;
	onSessionSelect: (sessionId: string) => void;
	onToggleGenui?: () => void;
	sending: boolean;
	sessions: UserSessionRow[];
}

function GenuiToggle({
	active,
	onToggle,
}: {
	active: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			aria-label="Generative UI"
			aria-pressed={active}
			className={cn(
				"gap-1.5",
				active && "bg-primary/10 text-primary hover:bg-primary/15"
			)}
			onClick={onToggle}
			size="sm"
			title="Generative UI: the agent replies with interactive UI"
			type="button"
			variant="ghost"
		>
			<SparklesIcon className="size-4" />
			<span className="text-xs">Generative UI</span>
		</Button>
	);
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
				<Button
					aria-label="Close"
					onClick={onClose}
					size="icon"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			</div>
		</header>
	);
}

function ComposerInput({
	agentName,
	text,
	sending,
	genuiActive,
	onTextChange,
	onSubmit,
	onToggleGenui,
}: {
	agentName: string;
	text: string;
	sending: boolean;
	genuiActive?: boolean;
	onTextChange: (v: string) => void;
	onSubmit: () => void;
	onToggleGenui?: () => void;
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
						<PromptInputTools>
							{onToggleGenui ? (
								<GenuiToggle
									active={genuiActive === true}
									onToggle={onToggleGenui}
								/>
							) : null}
						</PromptInputTools>
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
	genuiActive,
	onClose,
	onSend,
	onSessionSelect,
	onToggleGenui,
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
				genuiActive={genuiActive}
				onSubmit={handleSubmit}
				onTextChange={setText}
				onToggleGenui={onToggleGenui}
				sending={sending}
				text={text}
			/>
		</div>
	);
}
