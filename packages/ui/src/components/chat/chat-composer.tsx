import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from "@better-agent/ui/components/prompt-input";
import type { AgentClient } from "@curiousbus/agent-client";
import { ImagePlusIcon, Loader2Icon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import type { AttachmentRef } from "./chat-blocks";

const ACCEPT_IMAGES = "image/png,image/jpeg,image/webp,image/gif";

interface PendingAttachment {
	attachmentId?: string;
	localId: string;
	mime: string;
	name: string;
	previewUrl: string;
	status: "uploading" | "done" | "error";
}

function usePendingAttachments(agentClient: AgentClient, sessionId: string) {
	const [items, setItems] = useState<PendingAttachment[]>([]);

	const patch = (localId: string, next: Partial<PendingAttachment>) =>
		setItems((prev) =>
			prev.map((it) => (it.localId === localId ? { ...it, ...next } : it))
		);

	const addFiles = (files: File[]) => {
		for (const file of files) {
			const localId = crypto.randomUUID();
			const item: PendingAttachment = {
				localId,
				previewUrl: URL.createObjectURL(file),
				name: file.name,
				mime: file.type,
				status: "uploading",
			};
			setItems((prev) => [...prev, item]);
			agentClient
				.uploadAttachment(sessionId, file)
				.then((res) => patch(localId, { status: "done", attachmentId: res.id }))
				.catch(() => patch(localId, { status: "error" }));
		}
	};

	const remove = (localId: string) =>
		setItems((prev) => {
			const target = prev.find((it) => it.localId === localId);
			if (target) {
				URL.revokeObjectURL(target.previewUrl);
			}
			return prev.filter((it) => it.localId !== localId);
		});

	const clear = () =>
		setItems((prev) => {
			for (const it of prev) {
				URL.revokeObjectURL(it.previewUrl);
			}
			return [];
		});

	return { items, addFiles, remove, clear };
}

/** The attachments ready to send (uploaded successfully). */
function readyAttachments(items: PendingAttachment[]): AttachmentRef[] {
	const ready: AttachmentRef[] = [];
	for (const it of items) {
		if (it.status === "done" && it.attachmentId) {
			ready.push({
				attachmentId: it.attachmentId,
				mime: it.mime,
				name: it.name,
			});
		}
	}
	return ready;
}

function Chip({
	item,
	onRemove,
}: {
	item: PendingAttachment;
	onRemove: (localId: string) => void;
}) {
	return (
		<div className="relative">
			<img
				alt={item.name}
				className="size-14 rounded-md border object-cover"
				height={56}
				src={item.previewUrl}
				width={56}
			/>
			{item.status === "uploading" ? (
				<div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
					<Loader2Icon className="size-4 animate-spin text-white" />
				</div>
			) : null}
			{item.status === "error" ? (
				<div className="absolute inset-0 rounded-md ring-2 ring-destructive" />
			) : null}
			<button
				aria-label={`Remove ${item.name}`}
				className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
				onClick={() => onRemove(item.localId)}
				type="button"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}

function ChipRow({
	items,
	onRemove,
}: {
	items: PendingAttachment[];
	onRemove: (localId: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-2 px-1 pb-2">
			{items.map((it) => (
				<Chip item={it} key={it.localId} onRemove={onRemove} />
			))}
		</div>
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

interface ChatComposerProps {
	agentClient: AgentClient;
	onSend: (text: string, attachments: AttachmentRef[]) => void;
	onStop: () => void;
	sessionId: string;
	streaming: boolean;
}

export function ChatComposer({
	streaming,
	onSend,
	onStop,
	agentClient,
	sessionId,
}: ChatComposerProps) {
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
					<PromptInputToolbar>
						<AttachButton onFiles={addFiles} />
						<PromptInputSubmit
							onStop={onStop}
							status={streaming ? "streaming" : "idle"}
						/>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}
