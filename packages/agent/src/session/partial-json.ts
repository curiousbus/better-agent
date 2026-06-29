const WHITESPACE_RE = /\s/;
const KEY_ONLY_RE = /(?:[{,])\s*"(?:[^"\\]|\\.)*"$/;
const TRAILING_STR_RE = /\s*"(?:[^"\\]|\\.)*"$/;

interface ScanState {
	escaped: boolean;
	inString: boolean;
	stack: string[]; // "}" or "]" closers, innermost last
}

interface StringScanResult {
	escaped: boolean;
	inString: boolean;
}

function scanStringChar(ch: string, escaped: boolean): StringScanResult {
	if (escaped) {
		return { escaped: false, inString: true };
	}
	if (ch === "\\") {
		return { escaped: true, inString: true };
	}
	if (ch === '"') {
		return { escaped: false, inString: false };
	}
	return { escaped: false, inString: true };
}

function scan(buffer: string): ScanState {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (const ch of buffer) {
		if (inString) {
			const result = scanStringChar(ch, escaped);
			inString = result.inString;
			escaped = result.escaped;
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			stack.push("}");
		} else if (ch === "[") {
			stack.push("]");
		} else if (ch === "}" || ch === "]") {
			stack.pop();
		}
	}
	return { inString, escaped, stack };
}

// Trim a trailing fragment that can't be closed into valid JSON: an open key
// with no value (…,"b" or {"b"), a dangling colon, or a trailing comma.
function trimDangling(text: string): string {
	let end = text.length;
	while (end > 0 && WHITESPACE_RE.test(text[end - 1] as string)) {
		end--;
	}
	let s = text.slice(0, end);
	if (s.endsWith(",") || s.endsWith(":")) {
		return s.slice(0, -1);
	}
	// A trailing complete string that sits where a key would be (no following colon).
	if (KEY_ONLY_RE.test(s)) {
		s = s.replace(TRAILING_STR_RE, "");
		return s.endsWith(",") ? s.slice(0, -1) : s;
	}
	return s;
}

function close(buffer: string, state: ScanState): string {
	let s = buffer;
	if (state.inString) {
		s += state.escaped ? '\\"' : '"';
	}
	s = trimDangling(s);
	const rescanned = scan(s);
	let out = s;
	for (let i = rescanned.stack.length - 1; i >= 0; i--) {
		out += rescanned.stack[i];
	}
	return out;
}

function safeParse(text: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		// Unparseable even after completion: leave `parsed` undefined.
	}
	return parsed;
}

/** Best-effort parse of a possibly-truncated JSON buffer. */
export function completePartialJson(buffer: string): unknown {
	const trimmed = buffer.trim();
	const direct = safeParse(trimmed);
	return direct === undefined
		? safeParse(close(trimmed, scan(trimmed)))
		: direct;
}
