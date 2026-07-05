import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";

export interface TerminalComposerProps {
	disabled: boolean;
	onSend: (text: string) => void;
	sending: boolean;
}

/**
 * Bottom input box for a bridge terminal, styled to match the normal chat
 * composer (centered, rounded card, arrow submit). Posts via `onSend` and
 * clears; the guard keeps a send from firing while disabled or in flight.
 */
export function TerminalComposer({
	disabled,
	sending,
	onSend,
}: TerminalComposerProps) {
	const [text, setText] = useState("");

	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || disabled || sending) {
			return;
		}
		onSend(trimmed);
		setText("");
	};

	return (
		<div className="shrink-0 border-t px-3 py-3 sm:px-4">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					className="rounded-2xl border bg-background p-2 shadow-sm"
					onSubmit={submit}
				>
					<PromptInputTextarea
						disabled={disabled}
						onChange={setText}
						onSubmit={submit}
						placeholder={
							disabled ? "Waiting for connection…" : "Send a message…"
						}
						value={text}
					/>
					<PromptInputToolbar>
						<PromptInputTools />
						<Button
							aria-label="Send"
							disabled={disabled || sending || text.trim() === ""}
							size="icon-sm"
							type="submit"
						>
							<ArrowUpIcon className="size-4" />
						</Button>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
}
