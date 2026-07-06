import { Button } from "@better-agent/ui/components/button";
import {
	PromptInput,
	type PromptInputComboboxAria,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { SlashPickerList } from "./slash-picker-list";
import { ComposerControls } from "./terminal-controls";
import { type UseSlashPickerResult, useSlashPicker } from "./use-slash-picker";

const NOOP = () => undefined;
const NO_MODES: readonly string[] = [];

export interface TerminalComposerProps {
	/** True while this agent supports mid-turn interruption — controls whether a
	 * Stop button (vs. a disabled Send) is offered while a turn is in flight. */
	canInterrupt?: boolean;
	disabled: boolean;
	/** The session's active model, highlighted in the model menu. */
	model?: string;
	/** The model ids the agent reports (`session_ready.models`); the model menu
	 * lists exactly these and is hidden when empty. */
	models?: string[];
	/** Cancels the in-flight turn — wired to the Stop button. */
	onInterrupt?: () => void;
	onSend: (text: string) => void;
	onSetModel?: (model: string) => void;
	onSetPermissionMode?: (mode: string) => void;
	/** The session's active permission mode, highlighted in the mode menu. */
	permissionMode?: string;
	/** The permission-mode values this agent accepts; the mode menu is hidden
	 * when empty. */
	permissionModes?: readonly string[];
	sending: boolean;
	/** The session's reported skill names (see `session_ready`'s `skills`) —
	 * `undefined` before the session has reported them, in which case the "/"
	 * picker never opens (there is nothing yet to show). */
	skills?: string[];
	/** The session's reported slash-command names (see `session_ready`'s
	 * `slashCommands`) — same "absent until reported" contract as `skills`. */
	slashCommands?: string[];
	/** True from the user's send until the turn completes — swaps Send for Stop
	 * (when `canInterrupt`) so the user can cancel a long-running turn. */
	turnInFlight?: boolean;
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

interface ComposerToolbarProps {
	canStop: boolean;
	controlsDisabled: boolean;
	model?: string;
	models?: string[];
	onInterrupt: () => void;
	onSetModel: (model: string) => void;
	onSetPermissionMode: (mode: string) => void;
	permissionMode?: string;
	permissionModes: readonly string[];
	sendDisabled: boolean;
}

/** Send — or Stop, while a turn is interruptibly in flight. */
function SendOrStopButton({
	canStop,
	onInterrupt,
	sendDisabled,
}: {
	canStop: boolean;
	onInterrupt: () => void;
	sendDisabled: boolean;
}) {
	if (canStop) {
		return (
			<Button
				aria-label="Stop"
				onClick={onInterrupt}
				size="icon-sm"
				type="button"
				variant="destructive"
			>
				<SquareIcon className="size-3.5" />
			</Button>
		);
	}
	return (
		<Button
			aria-label="Send"
			disabled={sendDisabled}
			size="icon-sm"
			type="submit"
		>
			<ArrowUpIcon className="size-4" />
		</Button>
	);
}

/** The composer's bottom bar: everything sits bottom-RIGHT next to each other —
 * the agent-reported control menus ([model] [permission]) then Send/Stop — with
 * an empty spacer on the left so the toolbar's `justify-between` pushes the
 * cluster to the right. Split out of `TerminalComposer` to keep it under the
 * max-lines-per-function gate. */
function ComposerToolbar({
	canStop,
	controlsDisabled,
	model,
	models,
	onInterrupt,
	onSetModel,
	onSetPermissionMode,
	permissionMode,
	permissionModes,
	sendDisabled,
}: ComposerToolbarProps) {
	return (
		<PromptInputToolbar>
			<div aria-hidden="true" />
			<PromptInputTools>
				<ComposerControls
					disabled={controlsDisabled}
					model={model}
					models={models}
					onSetModel={onSetModel}
					onSetPermissionMode={onSetPermissionMode}
					permissionMode={permissionMode}
					permissionModes={permissionModes}
				/>
				<SendOrStopButton
					canStop={canStop}
					onInterrupt={onInterrupt}
					sendDisabled={sendDisabled}
				/>
			</PromptInputTools>
		</PromptInputToolbar>
	);
}

interface ComposerBoxProps {
	disabled: boolean;
	picker: UseSlashPickerResult;
	setText: (text: string) => void;
	submit: () => void;
	text: string;
	toolbar: ReactNode;
}

/** The "/" picker (when open) stacked above the prompt input itself — split
 * out of `TerminalComposer` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function ComposerBox({
	disabled,
	picker,
	setText,
	submit,
	text,
	toolbar,
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
				{toolbar}
			</PromptInput>
		</div>
	);
}

/**
 * Bottom input box for a bridge terminal, styled to match the normal chat
 * composer (centered, rounded card). The toolbar's bottom-right cluster carries
 * the agent's own control menus ([model] [permission mode] — see
 * `ComposerControls`) followed by Send, which swaps to Stop while an
 * interruptible turn is in flight. Posts via `onSend` and clears; the guard
 * keeps a send from firing while disabled or in flight.
 *
 * Typing "/" at the start of an empty box opens a command/skill picker (see
 * `use-slash-picker.ts`) fed by the session's own reported capabilities.
 * Selecting an item only fills the box (`/name `); sending still goes through
 * the same `onSend` path as any other line.
 */
export function TerminalComposer(props: TerminalComposerProps) {
	const { disabled, sending } = props;
	const [text, setText] = useState("");
	const picker = useSlashPicker({
		commands: props.slashCommands,
		setText,
		skills: props.skills,
		text,
	});

	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || disabled || sending) {
			return;
		}
		props.onSend(trimmed);
		setText("");
	};

	const toolbar = (
		<ComposerToolbar
			canStop={(props.turnInFlight ?? false) && (props.canInterrupt ?? false)}
			controlsDisabled={disabled}
			model={props.model}
			models={props.models}
			onInterrupt={props.onInterrupt ?? NOOP}
			onSetModel={props.onSetModel ?? NOOP}
			onSetPermissionMode={props.onSetPermissionMode ?? NOOP}
			permissionMode={props.permissionMode}
			permissionModes={props.permissionModes ?? NO_MODES}
			sendDisabled={disabled || sending || text.trim() === ""}
		/>
	);

	return (
		<div className="shrink-0 px-3 py-3 sm:px-4">
			<ComposerBox
				disabled={disabled}
				picker={picker}
				setText={setText}
				submit={submit}
				text={text}
				toolbar={toolbar}
			/>
		</div>
	);
}
