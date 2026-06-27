import type { AuthzClient } from "@better-agent/agent/ports";
import { env } from "@better-agent/env/server";

interface RedeemResult {
	authorized: boolean;
	reason?: string;
}

// Calls the standalone authz service's machine-to-machine API. When AUTHZ_URL is
// unset the feature is OFF and everything is allowed (so the system runs without
// authz). When configured, errors fail CLOSED (deny) — the 60s cache means a
// transient authz outage only affects entries that have already gone stale.
export function buildAuthzClient(): AuthzClient {
	const url = env.AUTHZ_URL;
	const secret = env.AUTHZ_SERVICE_SECRET;
	const enabled = Boolean(url && secret);

	const call = async <T>(path: string, body: unknown): Promise<T> => {
		const res = await fetch(`${url}${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-service-secret": secret ?? "",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`authz ${path} → ${res.status}`);
		}
		return (await res.json()) as T;
	};

	return {
		enabled,
		async authorize(subject) {
			if (!enabled) {
				return true;
			}
			const result = await call<{ authorized: boolean }>("/service/authorize", {
				subject,
			});
			return result.authorized;
		},
		redeem(subject, code) {
			if (!enabled) {
				return Promise.resolve({ authorized: true });
			}
			return call<RedeemResult>("/service/redeem", { subject, code });
		},
	};
}
