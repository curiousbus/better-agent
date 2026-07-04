import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	PromptInputTextarea,
	PromptInputToolbar,
} from "@better-agent/ui/components/prompt-input";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";

export interface TerminalComposerProps {
	disabled: boolean;
	onSend: (text: string) => void;
	sending: boolean;
}

/** Bottom input box for a bridge terminal: posts via `onSend` and clears. */
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
		<PromptInput className="shrink-0" onSubmit={submit}>
			<PromptInputTextarea
				disabled={disabled}
				onChange={setText}
				onSubmit={submit}
				placeholder={
					disabled ? "Waiting for connection…" : "Send input to the agent…"
				}
				value={text}
			/>
			<PromptInputToolbar>
				<span />
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
	);
}
