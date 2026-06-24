export const MAX_OUTPUT_BYTES = 51_200;
export const MAX_OUTPUT_LINES = 2000;

function notice(original: number): string {
	return `\n[output truncated — ${original} chars total; showing the head]`;
}

export function truncateOutput(text: string): {
	output: string;
	truncated: boolean;
} {
	const lines = text.split("\n");
	let head = text;
	let truncated = false;
	if (lines.length > MAX_OUTPUT_LINES) {
		head = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
		truncated = true;
	}
	if (head.length > MAX_OUTPUT_BYTES) {
		head = head.slice(0, MAX_OUTPUT_BYTES);
		truncated = true;
	}
	return truncated
		? { output: head + notice(text.length), truncated: true }
		: { output: text, truncated: false };
}
