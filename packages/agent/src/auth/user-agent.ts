const BROWSERS: [RegExp, string][] = [
	[/Edg\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Chrome\//, "Chrome"],
	[/Safari\//, "Safari"],
	[/Firefox\//, "Firefox"],
];

const SYSTEMS: [RegExp, string][] = [
	[/iPhone|iPad/, "iOS"],
	[/Android/, "Android"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/Linux/, "Linux"],
];

function matchTable(ua: string, table: [RegExp, string][]): string | null {
	for (const [re, name] of table) {
		if (re.test(ua)) {
			return name;
		}
	}
	return null;
}

/** Best-effort "Browser · OS" label from a user-agent string. */
export function parseUserAgent(ua: string | null): string {
	if (!ua) {
		return "Unknown device";
	}
	const browser = matchTable(ua, BROWSERS);
	const system = matchTable(ua, SYSTEMS);
	if (browser && system) {
		return `${browser} · ${system}`;
	}
	return browser ?? system ?? "Unknown device";
}
