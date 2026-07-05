// Pure logic for the composer's slash-command / skills picker (mirrors
// typing "/" in the Claude Code CLI). Kept out of the composer/rendering
// components so parsing/filtering/selection stay unit-testable without
// rendering anything — same split as bridge-session-status.ts /
// bridge-usage-format.ts.

export type SlashPickerItemKind = "command" | "skill";

export interface SlashPickerItem {
	kind: SlashPickerItemKind;
	/** Bare name, no leading slash (e.g. "compact", "pdf") — the CLI's init
	 * reports names this way (see apps/bridge-cli/src/normalize/claude-code.ts),
	 * but a leading slash is stripped defensively in case a caller passes one. */
	name: string;
}

const SLASH_QUERY_PATTERN = /^\/(\S*)$/;

/**
 * Whether the composer's current text is "mid slash-command entry", and if
 * so, the query typed so far (without the leading slash). Only the very
 * start of the box counts — a "/" appearing mid-message (or once a space
 * follows it, meaning the user has moved on to typing an argument) does not
 * (re)open the picker, matching how the Claude Code CLI itself only offers
 * the picker for a slash at the start of an empty prompt.
 */
export function parseSlashQuery(text: string): string | null {
	const match = SLASH_QUERY_PATTERN.exec(text);
	return match ? match[1] : null;
}

function stripLeadingSlash(name: string): string {
	return name.startsWith("/") ? name.slice(1) : name;
}

export interface SlashPickerSource {
	commands?: string[];
	skills?: string[];
}

/**
 * Builds the filtered, grouped item list for a query: commands first, then
 * skills, each filtered by case-insensitive prefix match. An adapter that
 * hasn't reported one of the two lists at all (undefined, vs. an empty
 * array) simply contributes nothing — the caller renders an empty/absent
 * picker rather than a misleading "no skills" state.
 */
export function buildSlashPickerItems(
	source: SlashPickerSource,
	query: string
): SlashPickerItem[] {
	const lowerQuery = query.toLowerCase();
	const matches = (name: string) =>
		stripLeadingSlash(name).toLowerCase().startsWith(lowerQuery);
	const toItems = (names: string[] | undefined, kind: SlashPickerItemKind) =>
		(names ?? [])
			.filter(matches)
			.map(
				(name): SlashPickerItem => ({ kind, name: stripLeadingSlash(name) })
			);
	return [
		...toItems(source.commands, "command"),
		...toItems(source.skills, "skill"),
	];
}

/** The text the composer should be set to once `item` is selected — always
 * a bare insertion (never auto-sent), so the user can append arguments
 * before pressing Enter, or just press Enter immediately for an arg-less
 * command/skill. */
export function applySlashPickerSelection(item: SlashPickerItem): string {
	return `/${item.name} `;
}

/** Wraps an index into `[0, itemCount)`, wrapping around at either end —
 * used by arrow-key navigation over the picker list. Returns 0 for an empty
 * list (there is nothing to select, but callers shouldn't have to
 * special-case a NaN/negative index). */
export function clampActiveIndex(index: number, itemCount: number): number {
	if (itemCount <= 0) {
		return 0;
	}
	if (index < 0) {
		return itemCount - 1;
	}
	if (index >= itemCount) {
		return 0;
	}
	return index;
}
