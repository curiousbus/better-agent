import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from "@better-agent/ui/components/prompt-input";
import type { AgentClient } from "@curiousbus/agent-client";
import { ImagePlusIcon, SparklesIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
	ChipRow,
	readyAttachments,
	usePendingAttachments,
} from "./chat-attachments";
import type { AttachmentRef } from "./chat-blocks";

const ACCEPT_IMAGES = "image/png,image/jpeg,image/webp,image/gif";

function GenuiToggle({
	active,
	onToggle,
}: {
	active: boolean;
	onToggle: () => void;
}) {
	return (
		<Button
			aria-label="Toggle generative UI"
			aria-pressed={active}
			className={active ? "text-primary" : "text-muted-foreground"}
			onClick={onToggle}
			size="icon"
			title="Generative UI: agent replies render as interactive UI"
			type="button"
			variant="ghost"
		>
			<SparklesIcon className="size-4" />
		</Button>
	);
}

function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	return (
		<div className="flex items-center">
			<input
				accept={ACCEPT_IMAGES}
				aria-label="Attach image"
				className="hidden"
				multiple
				onChange={(event) => {
					onFiles([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
				ref={fileRef}
				type="file"
			/>
			<Button
				aria-label="Attach image"
				onClick={() => fileRef.current?.click()}
				size="icon"
				type="button"
				variant="ghost"
			>
				<ImagePlusIcon className="size-4" />
			</Button>
		</div>
	);
}

function ComposerToolbar({
	onFiles,
	genuiActive,
	genuiAvailable,
	onToggleGenui,
	onStop,
	streaming,
}: {
	genuiActive?: boolean;
	genuiAvailable?: boolean;
	onFiles: (files: File[]) => void;
	onStop: () => void;
	onToggleGenui?: () => void;
	streaming: boolean;
}) {
	return (
		<PromptInputToolbar>
			<AttachButton onFiles={onFiles} />
			{genuiAvailable && onToggleGenui ? (
				<GenuiToggle active={genuiActive === true} onToggle={onToggleGenui} />
			) : null}
			<PromptInputSubmit
				onStop={onStop}
				status={streaming ? "streaming" : "idle"}
			/>
		</PromptInputToolbar>
	);
}

interface ChatComposerProps {
	agentClient: AgentClient;
	genuiActive?: boolean;
	genuiAvailable?: boolean;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	onStop: () => void;
	onToggleGenui?: () => void;
	sessionId: string;
	streaming: boolean;
}

function useComposerState({
	agentClient,
	sessionId,
	streaming,
	onSend,
}: {
	agentClient: AgentClient;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	sessionId: string;
	streaming: boolean;
}) {
	const [text, setText] = useState("");
	const { items, addFiles, remove, clear } = usePendingAttachments(
		agentClient,
		sessionId
	);
	const uploading = items.some((it) => it.status === "uploading");
	const submit = () => {
		const trimmed = text.trim();
		const ready = readyAttachments(items);
		if (streaming || uploading || (trimmed === "" && ready.length === 0)) {
			return;
		}
		onSend(trimmed, ready);
		setText("");
		clear();
	};
	return { text, setText, items, addFiles, remove, submit };
}

export function ChatComposer({
	streaming,
	onSend,
	onStop,
	agentClient,
	sessionId,
	genuiActive,
	genuiAvailable,
	onToggleGenui,
}: ChatComposerProps) {
	const { text, setText, items, addFiles, remove, submit } = useComposerState({
		agentClient,
		sessionId,
		streaming,
		onSend,
	});

	return (
		<div className="shrink-0 px-3 pb-4 sm:px-4">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					className="rounded-2xl border bg-background p-2 shadow-sm"
					onSubmit={submit}
				>
					<ChipRow items={items} onRemove={remove} />
					<PromptInputTextarea
						disabled={streaming}
						onChange={setText}
						onSubmit={submit}
						placeholder="Send a message…"
						value={text}
					/>
					<ComposerToolbar
						genuiActive={genuiActive}
						genuiAvailable={genuiAvailable}
						onFiles={addFiles}
						onStop={onStop}
						onToggleGenui={onToggleGenui}
						streaming={streaming}
					/>
				</PromptInput>
			</div>
		</div>
	);
}
