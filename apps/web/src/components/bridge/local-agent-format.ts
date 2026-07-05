/** Formats a session timestamp (`createdAt`/`lastSeenAt`) using the
 * browser's locale — shared by the list cards and the detail header so the
 * two surfaces never drift into different date formats. */
export function formatSessionTimestamp(value: Date): string {
	return new Date(value).toLocaleString();
}
