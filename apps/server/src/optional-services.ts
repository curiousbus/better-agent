import type { SettingsStore } from "@better-agent/agent/ports";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
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
	let cache: { key: string; service: ComposioService } | null = null;
	return async (): Promise<ComposioService | null> => {
		const key =
			(await settings.get("COMPOSIO_API_KEY")) ?? env.COMPOSIO_API_KEY ?? null;
		if (!key) {
			cache = null;
			return null;
		}
		if (cache?.key !== key) {
			cache = {
				key,
				service: createComposioService({
					apiKey: key,
					toolkits: env.COMPOSIO_TOOLKITS,
				}),
			};
		}
		return cache.service;
	};
}
