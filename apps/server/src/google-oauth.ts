import type { GoogleOAuth } from "@better-agent/agent/ports";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export function createGoogleOAuth(config: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}): GoogleOAuth {
	return {
		authUrl(state) {
			const params = new URLSearchParams({
				client_id: config.clientId,
				redirect_uri: config.redirectUri,
				response_type: "code",
				scope: "openid email",
				state,
				access_type: "online",
				prompt: "select_account",
			});
			return `${AUTH_ENDPOINT}?${params.toString()}`;
		},
		async exchangeCode(code) {
			const tokenRes = await fetch(TOKEN_ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: config.clientId,
					client_secret: config.clientSecret,
					redirect_uri: config.redirectUri,
					grant_type: "authorization_code",
				}),
			});
			if (!tokenRes.ok) {
				throw new Error("Google token exchange failed");
			}
			const token = (await tokenRes.json()) as { access_token: string };
			const infoRes = await fetch(USERINFO_ENDPOINT, {
				headers: { authorization: `Bearer ${token.access_token}` },
			});
			if (!infoRes.ok) {
				throw new Error("Google userinfo request failed");
			}
			const info = (await infoRes.json()) as {
				email: string;
				email_verified: boolean;
			};
			return { email: info.email, emailVerified: info.email_verified === true };
		},
	};
}
