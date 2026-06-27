import type { AuthzClient } from "@better-agent/agent/ports";
import { env } from "@better-agent/env/server";

interface RedeemResult {
	authorized: boolean;
	reason?: string;
}

// A Cloudflare service binding (worker-to-worker). Same-account workers can't
// reliably reach each other over their public URLs, so on Workers we call authz
// through this binding; on Node we fall back to a normal fetch of AUTHZ_URL.
export interface ServiceBinding {
	fetch(request: Request): Promise<Response>;
}

// Calls the standalone authz service. OFF (everything allowed) when neither a
// binding nor AUTHZ_URL is configured. When configured, errors fail CLOSED — the
// 60s cache means a transient outage only affects entries that have gone stale.
export function buildAuthzClient(binding?: ServiceBinding): AuthzClient {
	const url = env.AUTHZ_URL;
	const secret = env.AUTHZ_SERVICE_SECRET;
	const enabled = Boolean((binding || url) && secret);

	const call = async <T>(path: string, body: unknown): Promise<T> => {
		const init: RequestInit = {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-service-secret": secret ?? "",
			},
			body: JSON.stringify(body),
		};
		const res = binding
			? await binding.fetch(new Request(`https://authz.internal${path}`, init))
			: await fetch(`${url}${path}`, init);
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
