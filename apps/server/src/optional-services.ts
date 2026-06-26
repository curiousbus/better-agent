import type { SettingsStore } from "@better-agent/agent/ports";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import { composioKeyName } from "@better-agent/agent/tool/composio-tools";
import { env } from "@better-agent/env/server";

import { createComposioService } from "./composio";
import { createGoogleOAuth } from "./google-oauth";

/** Optional, env-gated integrations: return null when unconfigured. */

export function buildGoogleOAuth() {
	if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
		return null;
	}
	return createGoogleOAuth({
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUri: `${env.WEB_URL}/auth/google/callback`,
	});
}

export function buildComposioResolver(settings: SettingsStore) {
	const cache = new Map<string, { key: string; service: ComposioService }>();
	return async (userId: string): Promise<ComposioService | null> => {
		const key = await settings.get(composioKeyName(userId));
		if (!key) {
			cache.delete(userId);
			return null;
		}
		const cached = cache.get(userId);
		if (cached?.key !== key) {
			cache.set(userId, {
				key,
				service: createComposioService({ apiKey: key }),
			});
		}
		return cache.get(userId)?.service ?? null;
	};
}
