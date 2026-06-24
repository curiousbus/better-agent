/** Day-precision context appended to the system prompt each turn (cache-friendly). */
export function buildDynamicContext(now: Date): string {
	return `Current date: ${now.toISOString().slice(0, 10)}`;
}
