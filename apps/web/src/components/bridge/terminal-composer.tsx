import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	type PromptInputComboboxAria,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { SlashPickerList } from "./slash-picker-list";
import { type UseSlashPickerResult, useSlashPicker } from "./use-slash-picker";

export interface TerminalComposerProps {
	disabled: boolean;
	onSend: (text: string) => void;
	sending: boolean;
	/** The session's reported skill names (see `session_ready`'s `skills`) —
	 * `undefined` before the session has reported them, in which case the "/"
	 * picker never opens (there is nothing yet to show). */
	skills?: string[];
	/** The session's reported slash-command names (see `session_ready`'s
	 * `slashCommands`) — same "absent until reported" contract as `skills`. */
	slashCommands?: string[];
}

/** `aria-activedescendant`/`aria-controls` wiring for the textarea while the
 * picker is open — a bare textarea (no combobox semantics) otherwise. */
function comboboxAriaFor(
	picker: UseSlashPickerResult
): PromptInputComboboxAria | undefined {
	if (!picker.open) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		activeDescendant: picker.itemDomId(picker.activeIndex),
		controls: picker.listId,
	};
}

interface ComposerBoxProps {
	disabled: boolean;
	picker: UseSlashPickerResult;
	sending: boolean;
	setText: (text: string) => void;
	submit: () => void;
	text: string;
}

/** The "/" picker (when open) stacked above the prompt input itself — split
 * out of `TerminalComposer` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function ComposerBox({
	disabled,
	picker,
	sending,
	setText,
	submit,
	text,
}: ComposerBoxProps) {
	return (
		<div className="relative mx-auto w-full max-w-3xl">
			{picker.open && (
				<SlashPickerList
					activeIndex={picker.activeIndex}
					itemDomId={picker.itemDomId}
					items={picker.items}
					listId={picker.listId}
					onHover={picker.setActiveIndex}
					onSelect={picker.select}
				/>
			)}
			<PromptInput
				className="rounded-2xl border bg-background p-2 shadow-sm"
				onSubmit={submit}
			>
				<PromptInputTextarea
					comboboxAria={comboboxAriaFor(picker)}
					disabled={disabled}
					onChange={setText}
					onKeyDown={picker.handleKeyDown}
					onSubmit={submit}
					placeholder={disabled ? "Waiting for connection…" : "Send a message…"}
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
	);
}

/**
 * Bottom input box for a bridge terminal, styled to match the normal chat
 * composer (centered, rounded card, arrow submit). Posts via `onSend` and
 * clears; the guard keeps a send from firing while disabled or in flight.
 *
 * Typing "/" at the start of an empty box opens a command/skill picker (see
 * `use-slash-picker.ts`) fed by the session's own reported capabilities —
 * mirroring the Claude Code CLI's own "/" picker. Selecting an item only
 * fills the box (`/name `); sending still goes through the same `onSend`
 * path as any other line, since a slash command is just text to the agent.
 */
export function TerminalComposer({
	disabled,
	sending,
	onSend,
	skills,
	slashCommands,
}: TerminalComposerProps) {
	const [text, setText] = useState("");
	const picker = useSlashPicker({
		commands: slashCommands,
		setText,
		skills,
		text,
	});

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
			<ComposerBox
				disabled={disabled}
				picker={picker}
				sending={sending}
				setText={setText}
				submit={submit}
				text={text}
			/>
		</div>
	);
}
