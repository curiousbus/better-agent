const KEY = "board_session_id";

export function loadBoardSessionId(): string | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export function saveBoardSessionId(id: string): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// ignore storage failures (private mode, quota)
	}
}
