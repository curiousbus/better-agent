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

/** A parsed in-progress slash command: the text before the token (preserved
 * on selection) and the query typed after the slash. */
export interface SlashQuery {
	prefix: string;
	query: string;
}

const TRAILING_SLASH_TOKEN = /(^|\s)(\/(\S*))$/;

/**
 * Parses the composer's text for a slash-command token currently being typed
 * at the END — a `/<word>` with no space yet — ANYWHERE in the message, not
 * only at the very start (so `fix this /comp` offers commands too). Returns
 * the query plus the preceding `prefix` so a selection replaces just the
 * token, leaving anything typed before it intact. A slash mid-word (a path
 * like `a/b`) or a completed `/cmd arg` (a space already follows) doesn't match.
 */
export function parseSlashQuery(text: string): SlashQuery | null {
	const match = TRAILING_SLASH_TOKEN.exec(text);
	if (!match) {
		return null;
	}
	const slashIndex = match.index + match[1].length;
	return { prefix: text.slice(0, slashIndex), query: match[3] };
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
 * a bare insertion (never auto-sent) of `/<name> `, preserving any text typed
 * before the slash token (`prefix`), so the user can append arguments before
 * pressing Enter. */
export function applySlashPickerSelection(
	item: SlashPickerItem,
	prefix = ""
): string {
	return `${prefix}/${item.name} `;
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
