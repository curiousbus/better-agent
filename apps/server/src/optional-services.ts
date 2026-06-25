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

export function buildComposio() {
	if (!env.COMPOSIO_API_KEY) {
		return null;
	}
	return createComposioService({
		apiKey: env.COMPOSIO_API_KEY,
		toolkits: env.COMPOSIO_TOOLKITS,
	});
}
