export interface Code {
	active: boolean;
	code: string;
	id: string;
	label: string;
	maxRedemptions: number;
	redemptions: number;
	source: string;
}

export const TOKEN_KEY = "authz_token";

export function authHeaders(token: string | null): Record<string, string> {
	if (token === null) {
		return {};
	}
	return { Authorization: `Bearer ${token}` };
}

export class UnauthorizedError extends Error {}

function assertOk(res: Response): void {
	if (res.status === 401) {
		throw new UnauthorizedError("Unauthorized");
	}
	if (!res.ok) {
		throw new Error(`Request failed: ${res.status}`);
	}
}

export async function login(email: string, password: string): Promise<string> {
	const res = await fetch("/admin/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) {
		throw new Error(`Login failed: ${res.status}`);
	}
	const data = (await res.json()) as { token: string };
	return data.token;
}

export async function listCodes(token: string | null): Promise<Code[]> {
	const res = await fetch("/admin/codes", {
		headers: { "content-type": "application/json", ...authHeaders(token) },
	});
	assertOk(res);
	return res.json() as Promise<Code[]>;
}

export async function createCode(
	token: string | null,
	input: { label: string; source: string }
): Promise<Code> {
	const res = await fetch("/admin/codes", {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(token) },
		body: JSON.stringify(input),
	});
	assertOk(res);
	return res.json() as Promise<Code>;
}

export async function revokeCode(
	token: string | null,
	id: string
): Promise<void> {
	const res = await fetch(`/admin/codes/${id}/revoke`, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(token) },
	});
	assertOk(res);
}

export function decodeJwtEmail(token: string | null): string | null {
	if (token === null) {
		return null;
	}
	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}
	try {
		const [, middle] = parts;
		const segment = (middle ?? "").replace(/-/g, "+").replace(/_/g, "/");
		const payload = JSON.parse(atob(segment)) as { email?: unknown };
		return typeof payload.email === "string" ? payload.email : null;
	} catch {
		return null;
	}
}
