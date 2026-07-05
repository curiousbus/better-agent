import { Button } from "@better-agent/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { OctagonXIcon } from "lucide-react";

// Gated per adapter capability (plan Phase 0.5, see agent-capabilities.ts):
// Interrupt only for `interrupt`-capable agents, the model picker only for
// `modelSwitch`-capable agents, and the permission-mode dropdown restricted
// to (and hidden entirely absent) the agent's own `permissionModes` list —
// see apps/bridge-cli/src/adapters/claude-code.ts for claude's full set.

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
	/** The agent's own accepted permission-mode values (its capability's
	 * `permissionModes`) — the dropdown offers only these, and renders nothing
	 * at all when empty (the agent has no such concept). */
	permissionModes: readonly string[];
	/** Whether this agent supports `interrupt` — hides the button entirely
	 * when it doesn't, instead of showing a control that would just no-op. */
	showInterrupt: boolean;
	/** Whether this agent supports `modelSwitch` — hides the picker entirely
	 * when it doesn't. */
	showModelPicker: boolean;
}

/**
 * The Local Agent detail page's session controls: a Stop/Interrupt button
 * that cancels the in-flight turn without ending the session, a model
 * picker, and a permission-mode dropdown — all routed through
 * `useBridgeTerminal`'s `interrupt`/`setModel`/`setPermissionMode`, which relay
 * `{ type: "control", ... }` commands the same way approvals do (see
 * use-bridge-terminal.ts). Each control is individually gated on the running
 * agent's capabilities (see agent-capabilities.ts) — a picker or button for a
 * control the agent doesn't support would just no-op, so it isn't shown at
 * all rather than shown disabled. Deliberately unobtrusive otherwise: small
 * controls, no confirmation dialogs — Interrupt/model/mode are all reversible
 * mid-session.
 */
export function TerminalControls({
	disabled,
	onInterrupt,
	onSetModel,
	onSetPermissionMode,
	permissionMode,
	permissionModes,
	model,
	showInterrupt,
	showModelPicker,
}: TerminalControlsProps) {
	const permissionModeOptions = PERMISSION_MODE_OPTIONS.filter((option) =>
		permissionModes.includes(option.value)
	);
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{showInterrupt && (
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
			)}
			{showModelPicker && (
				<ControlSelect
					disabled={disabled}
					label="Model"
					onChange={onSetModel}
					options={MODEL_PRESETS}
					value={model}
				/>
			)}
			{permissionModeOptions.length > 0 && (
				<ControlSelect
					disabled={disabled}
					label="Permission mode"
					onChange={onSetPermissionMode}
					options={permissionModeOptions}
					value={permissionMode}
				/>
			)}
		</div>
	);
}
