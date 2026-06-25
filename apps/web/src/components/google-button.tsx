import { Button } from "@better-agent/ui/components/button";
import { toast } from "sonner";

import { client } from "@/utils/orpc";

async function startGoogleSignIn(): Promise<void> {
	const state = crypto.randomUUID();
	sessionStorage.setItem("google_oauth_state", state);
	try {
		const { url } = await client.auth.googleAuthUrl({ state });
		window.location.href = url;
	} catch (error) {
		toast.error(
			error instanceof Error ? error.message : "Google sign-in unavailable"
		);
	}
}

export function GoogleButton() {
	return (
		<Button onClick={startGoogleSignIn} type="button" variant="outline">
			Continue with Google
		</Button>
	);
}
