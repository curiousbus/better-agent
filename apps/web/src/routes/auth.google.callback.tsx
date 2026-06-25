import { Button } from "@better-agent/ui/components/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { setTokens } from "@/utils/auth";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/auth/google/callback")({
	validateSearch: (search: Record<string, unknown>) => ({
		code: typeof search.code === "string" ? search.code : "",
		state: typeof search.state === "string" ? search.state : "",
	}),
	component: GoogleCallbackPage,
});

type Status = "pending" | "error";

function isValidState(state: string): boolean {
	return state !== "" && sessionStorage.getItem("google_oauth_state") === state;
}

function handleCallback(
	code: string,
	state: string
): Promise<{ accessToken: string; refreshToken: string }> {
	if (!(code && isValidState(state))) {
		return Promise.reject(new Error("Invalid or expired Google sign-in"));
	}
	return client.auth.googleSignIn({ code });
}

function GoogleCallbackPage() {
	const { code, state } = Route.useSearch();
	const navigate = useNavigate();
	const [status, setStatus] = useState<Status>("pending");
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		let active = true;
		handleCallback(code, state)
			.then((result) => {
				if (!active) {
					return;
				}
				setTokens(result);
				sessionStorage.removeItem("google_oauth_state");
				navigate({ to: "/" });
			})
			.catch((error: unknown) => {
				if (!active) {
					return;
				}
				setErrorMessage(
					error instanceof Error ? error.message : "Google sign-in failed"
				);
				setStatus("error");
			});
		return () => {
			active = false;
		};
	}, [code, state, navigate]);

	if (status === "error") {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<p className="text-sm">{errorMessage}</p>
				<Button render={<Link to="/login" />}>Back to sign in</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
			Signing you in…
		</div>
	);
}
