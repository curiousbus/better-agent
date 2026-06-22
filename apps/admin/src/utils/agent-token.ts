const KEY_PREFIX = "agentToken:";

// The admin app is server-rendered (Nitro), so guard every localStorage access:
// these helpers are only meaningful in the browser. On the server they no-op.
function browserStorage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

export function saveAgentToken(agentId: string, token: string): void {
	browserStorage()?.setItem(`${KEY_PREFIX}${agentId}`, token);
}

export function loadAgentToken(agentId: string): string | null {
	return browserStorage()?.getItem(`${KEY_PREFIX}${agentId}`) ?? null;
}

export function clearAgentToken(agentId: string): void {
	browserStorage()?.removeItem(`${KEY_PREFIX}${agentId}`);
}
