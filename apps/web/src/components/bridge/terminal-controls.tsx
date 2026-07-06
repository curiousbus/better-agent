import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

// The composer's bottom-right control menus (relocated out of the header per
// the owner's feedback): a model menu and a permission-mode menu, sitting next
// to Send/Stop. Deliberately quiet — small, borderless, secondary triggers that
// match a modern chat composer rather than a hardcoded control strip. The MODEL
// control is ALWAYS present (never fully hidden) so the owner can always see
// what the agent is on, reflecting whatever the agent reports: the full list
// when it exposes `models`, just the current model when it reports only
// `model`, and a disabled "Model" affordance when it reports neither. The
// permission-mode menu stays capability-gated.

/** Shown as the model control's tooltip when the agent hasn't reported any
 * model yet — so the always-present affordance explains its disabled state
 * rather than looking broken. */
const NO_MODEL_REPORTED_TITLE = "This agent doesn't report a model list yet.";

interface PickerOption {
	label: string;
	value: string;
}

interface ModelControlState {
	/** A read-only label to render in the trigger — the current model when the
	 * agent reports no switchable list (a disabled `Select` never mounts its
	 * items, so `SelectValue` can't resolve the label on its own). */
	displayLabel?: string;
	/** Whether the agent exposed a switchable list — drives whether the menu is
	 * interactive (a real dropdown) or a read-only label. */
	hasList: boolean;
	options: PickerOption[];
	title?: string;
}

/** Resolves what the always-present model control should show from whatever the
 * agent reported: the full switchable list, else just the current model as a
 * read-only label, else an empty "Model" affordance with an explanatory tip. */
function resolveModelControl(
	model: string | undefined,
	models: string[] | undefined
): ModelControlState {
	if (models && models.length > 0) {
		return {
			hasList: true,
			options: models.map((id) => ({ label: id, value: id })),
		};
	}
	if (model) {
		return {
			displayLabel: model,
			hasList: false,
			options: [{ label: model, value: model }],
		};
	}
	return { hasList: false, options: [], title: NO_MODEL_REPORTED_TITLE };
}

/** Human labels for the SDK's `PermissionMode` values (mirrors
 * `PERMISSION_MODES` in `apps/bridge-cli/src/adapters/claude-code.ts`); any
 * mode not listed falls back to its raw wire value. */
const PERMISSION_MODE_LABELS: Record<string, string> = {
	default: "Default",
	acceptEdits: "Accept edits",
	bypassPermissions: "Bypass permissions",
	plan: "Plan",
	dontAsk: "Don't ask",
	auto: "Auto",
};

/** Borderless, compact trigger so the menus read as secondary composer
 * controls rather than form fields; capped width so a long model id truncates
 * instead of overflowing the toolbar on narrow viewports. */
const CONTROL_TRIGGER_CLASS =
	"h-7 max-w-40 border-0 bg-transparent px-2 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground";

function firstStringValue(next: string | string[] | null): string | undefined {
	if (typeof next === "string") {
		return next;
	}
	return next?.[0];
}

interface ControlSelectProps {
	disabled: boolean;
	/** Explicit trigger text, overriding `SelectValue`'s own resolution — needed
	 * for a disabled menu whose items never mount (see `ModelControlState`). */
	displayLabel?: string;
	label: string;
	onChange: (value: string) => void;
	options: readonly PickerOption[];
	/** Native tooltip on the trigger — used to explain the model control's
	 * disabled state when the agent reports no model list. */
	title?: string;
	value?: string;
}

/** One compact composer menu, shared by the model and permission-mode
 * pickers — split out so `ComposerControls` stays under the repo's
 * max-lines-per-function gate. */
function ControlSelect({
	disabled,
	displayLabel,
	label,
	onChange,
	options,
	title,
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
			<SelectTrigger
				aria-label={label}
				className={CONTROL_TRIGGER_CLASS}
				size="sm"
				title={title}
			>
				<SelectValue placeholder={label}>
					{displayLabel ?? undefined}
				</SelectValue>
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

export interface ComposerControlsProps {
	/** Disables both menus — mirrors the composer's `disabled` (no live session
	 * to relay a control command to). */
	disabled: boolean;
	/** The session's currently-active model (from `session_ready`), highlighted
	 * in the menu. */
	model?: string;
	/** The model ids the agent reports it can switch between (`session_ready`'s
	 * `models`). When present the menu lists exactly these; when empty/absent the
	 * always-present model control falls back to the current model or a disabled
	 * affordance (see `resolveModelControl`). */
	models?: string[];
	onSetModel: (model: string) => void;
	onSetPermissionMode: (mode: string) => void;
	/** The session's currently-active permission mode (from `session_ready`). */
	permissionMode?: string;
	/** The permission-mode values this agent accepts (its capability's
	 * `permissionModes`); the menu is hidden entirely when empty. */
	permissionModes: readonly string[];
}

/**
 * The composer toolbar's bottom-right menus: an always-present model control
 * (a switchable dropdown when the agent reports `models`, the current model as
 * a read-only label when it reports only `model`, and a disabled "Model"
 * affordance otherwise) and a capability-gated permission-mode menu (rendered
 * only when the agent accepts any `permissionModes`). The model control is
 * never fully hidden, so the owner can always see what the agent is on.
 */
export function ComposerControls({
	disabled,
	model,
	models,
	onSetModel,
	onSetPermissionMode,
	permissionMode,
	permissionModes,
}: ComposerControlsProps) {
	const modelControl = resolveModelControl(model, models);
	const permissionOptions = permissionModes.map((mode) => ({
		label: PERMISSION_MODE_LABELS[mode] ?? mode,
		value: mode,
	}));
	return (
		<>
			<ControlSelect
				disabled={disabled || !modelControl.hasList}
				displayLabel={modelControl.displayLabel}
				label="Model"
				onChange={onSetModel}
				options={modelControl.options}
				title={modelControl.title}
				value={model}
			/>
			{permissionOptions.length > 0 && (
				<ControlSelect
					disabled={disabled}
					label="Permission mode"
					onChange={onSetPermissionMode}
					options={permissionOptions}
					value={permissionMode}
				/>
			)}
		</>
	);
}
