const REFRESH_KEY = "authRefreshToken";

// Access token lives in memory only (lost on reload — re-minted from the
// refresh token at bootstrap). The refresh token persists in localStorage.
let accessToken: string | null = null;

function storage(): Storage | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

export function getAccessToken(): string | null {
	return accessToken;
}

export function loadRefreshToken(): string | null {
	return storage()?.getItem(REFRESH_KEY) ?? null;
}

export function setTokens(tokens: {
	accessToken: string;
	refreshToken: string;
}): void {
	accessToken = tokens.accessToken;
	storage()?.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
	accessToken = null;
	storage()?.removeItem(REFRESH_KEY);
}
