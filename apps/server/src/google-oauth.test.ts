import { expect, it } from "vitest";
import { createGoogleOAuth } from "./google-oauth";

const CLIENT_ID = "test-client-id";
const REDIRECT_URI = "https://example.com/auth/google/callback";

function buildOAuth() {
	return createGoogleOAuth({
		clientId: CLIENT_ID,
		clientSecret: "test-client-secret",
		redirectUri: REDIRECT_URI,
	});
}

it("authUrl contains client_id, redirect_uri, response_type=code, state, and scope", () => {
	const google = buildOAuth();
	const state = "random-csrf-state-value";
	const url = google.authUrl(state);

	expect(url).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`);
	expect(url).toContain(`redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
	expect(url).toContain("response_type=code");
	expect(url).toContain(`state=${encodeURIComponent(state)}`);
	expect(url).toContain("scope=");
	expect(url).toContain("email");
});

it("authUrl uses the Google accounts consent endpoint", () => {
	const google = buildOAuth();
	const url = google.authUrl("some-state");
	expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
});
