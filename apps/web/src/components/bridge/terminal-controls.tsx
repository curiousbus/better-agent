import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

// The composer's bottom-bar control menus (Phase 5, relocated out of the
// header per the owner's feedback): a model menu and a permission-mode menu,
// each populated from what the running agent actually reports and hidden when
// it reports nothing. Deliberately quiet — small, borderless, secondary
// triggers that sit in the toolbar's left cluster next to Send/Stop, matching
// a modern chat composer rather than a hardcoded control strip.

interface PickerOption {
	label: string;
	value: string;
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
	label: string;
	onChange: (value: string) => void;
	options: readonly PickerOption[];
	value?: string;
}

/** One compact composer menu, shared by the model and permission-mode
 * pickers — split out so `ComposerControls` stays under the repo's
 * max-lines-per-function gate. */
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
			<SelectTrigger
				aria-label={label}
				className={CONTROL_TRIGGER_CLASS}
				size="sm"
			>
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

export interface ComposerControlsProps {
	/** Disables both menus — mirrors the composer's `disabled` (no live session
	 * to relay a control command to). */
	disabled: boolean;
	/** The session's currently-active model (from `session_ready`), highlighted
	 * in the menu. */
	model?: string;
	/** The model ids the agent reports it can switch between (`session_ready`'s
	 * `models`). The menu lists exactly these and is hidden when empty/absent. */
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
 * The composer toolbar's left-cluster menus: a model menu (from the agent's
 * reported `models`) and a permission-mode menu (from the agent's accepted
 * `permissionModes`). Each renders nothing when its source list is empty, so a
 * session only ever shows a menu it can actually act on — no hardcoded model
 * list, no control for a concept the agent doesn't have.
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
	const modelOptions = (models ?? []).map((id) => ({ label: id, value: id }));
	const permissionOptions = permissionModes.map((mode) => ({
		label: PERMISSION_MODE_LABELS[mode] ?? mode,
		value: mode,
	}));
	return (
		<>
			{modelOptions.length > 0 && (
				<ControlSelect
					disabled={disabled}
					label="Model"
					onChange={onSetModel}
					options={modelOptions}
					value={model}
				/>
			)}
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
