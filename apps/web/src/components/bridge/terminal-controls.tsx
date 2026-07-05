import { Button } from "@better-agent/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { OctagonXIcon } from "lucide-react";

// Claude-specific for now (the SDK's `query.setModel`/`setPermissionMode`
// control requests — see apps/bridge-cli/src/adapters/claude-code.ts); a
// later capability-abstraction task (plan Phase 0.5) will gate these per
// adapter instead of always showing them on the Local Agent detail page.

interface PickerOption {
	label: string;
	value: string;
}

/** A small preset list, not `supportedModels()` — the SDK only exposes that
 * via an async control request on the running query, which isn't threaded
 * through `session_ready` yet. These are the aliases the SDK itself resolves
 * (see `ModelInfo.resolvedModel` in the SDK's typings), so a preset always
 * means something even without the live list. */
const MODEL_PRESETS: readonly PickerOption[] = [
	{ label: "Default", value: "default" },
	{ label: "Opus", value: "opus" },
	{ label: "Sonnet", value: "sonnet" },
	{ label: "Haiku", value: "haiku" },
];

/** The SDK's full `PermissionMode` enum (mirrors
 * apps/bridge-cli/src/adapters/claude-code.ts's `PERMISSION_MODES`). */
const PERMISSION_MODE_OPTIONS: readonly PickerOption[] = [
	{ label: "Default", value: "default" },
	{ label: "Accept edits", value: "acceptEdits" },
	{ label: "Bypass permissions", value: "bypassPermissions" },
	{ label: "Plan", value: "plan" },
	{ label: "Don't ask", value: "dontAsk" },
	{ label: "Auto", value: "auto" },
];

function firstStringValue(next: string | string[] | null): string | undefined {
	if (typeof next === "string") {
		return next;
	}
	return next?.[0];
}

interface ControlSelectProps {
	disabled: boolean;
	label: string;
	onChange: (value: string) => void;
	options: readonly PickerOption[];
	value?: string;
}

/** One small preset dropdown shared by the model picker and the
 * permission-mode picker — split out so `TerminalControls` itself stays
 * under the repo's max-lines-per-function gate. */
function ControlSelect({
	disabled,
	label,
	onChange,
	options,
	value,
}: ControlSelectProps) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => {
				const picked = firstStringValue(next);
				if (picked) {
					onChange(picked);
				}
			}}
			value={value}
		>
			<SelectTrigger aria-label={label} className="h-6" size="sm">
				<SelectValue placeholder={label} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export interface TerminalControlsProps {
	/** Disables every control — mirrors the composer's `disabled` (no live
	 * session to send these to). */
	disabled: boolean;
	/** The session's currently-reported model (from `session_ready`), so the
	 * picker shows what's actually active instead of resetting to a
	 * placeholder every render. */
	model?: string;
	onInterrupt: () => void;
	onSetModel: (model: string) => void;
	onSetPermissionMode: (mode: string) => void;
	/** The session's currently-reported permission mode (from
	 * `session_ready`) — same "shows what's active" contract as `model`. */
	permissionMode?: string;
}

/**
 * The Local Agent detail page's claude session controls: a Stop/Interrupt
 * button that cancels the in-flight turn without ending the session, a model
 * picker, and a permission-mode dropdown — all routed through
 * `useBridgeTerminal`'s `interrupt`/`setModel`/`setPermissionMode`, which relay
 * `{ type: "control", ... }` commands the same way approvals do (see
 * use-bridge-terminal.ts). Deliberately unobtrusive: small controls, no
 * confirmation dialogs — Interrupt/model/mode are all reversible mid-session.
 */
export function TerminalControls({
	disabled,
	onInterrupt,
	onSetModel,
	onSetPermissionMode,
	permissionMode,
	model,
}: TerminalControlsProps) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Button
				aria-label="Interrupt"
				disabled={disabled}
				onClick={onInterrupt}
				size="xs"
				variant="outline"
			>
				<OctagonXIcon />
				Interrupt
			</Button>
			<ControlSelect
				disabled={disabled}
				label="Model"
				onChange={onSetModel}
				options={MODEL_PRESETS}
				value={model}
			/>
			<ControlSelect
				disabled={disabled}
				label="Permission mode"
				onChange={onSetPermissionMode}
				options={PERMISSION_MODE_OPTIONS}
				value={permissionMode}
			/>
		</div>
	);
}
