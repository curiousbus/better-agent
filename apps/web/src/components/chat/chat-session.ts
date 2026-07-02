const KEY = "last_chat";

export interface LastChat {
	agentId: string;
	sessionId: string;
}

// Remember the active chat (per tab) so navigating away and back re-attaches to
// the SAME session — including one that is still streaming — instead of
// creating a fresh session each visit.
export function loadLastChat(): LastChat | null {
	if (typeof sessionStorage === "undefined") {
		return null;
	}
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<LastChat>;
		if (
			typeof parsed.agentId === "string" &&
			typeof parsed.sessionId === "string"
		) {
			return { agentId: parsed.agentId, sessionId: parsed.sessionId };
		}
		return null;
	} catch {
		return null;
	}
}

export function saveLastChat(chat: LastChat): void {
	if (typeof sessionStorage !== "undefined") {
		sessionStorage.setItem(KEY, JSON.stringify(chat));
	}
}

export function clearLastChat(): void {
	if (typeof sessionStorage !== "undefined") {
		sessionStorage.removeItem(KEY);
	}
}
