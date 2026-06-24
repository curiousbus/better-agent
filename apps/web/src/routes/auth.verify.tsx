import { Button } from "@better-agent/ui/components/button";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { setTokens } from "@/utils/auth";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/auth/verify")({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === "string" ? search.token : "",
	}),
	component: VerifyPage,
});

function VerifyPage() {
	const { token } = Route.useSearch();
	const navigate = useNavigate();
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		client.auth
			.verify({ token })
			.then((result) => {
				if (active) {
					setTokens(result);
					navigate({ to: "/" });
				}
			})
			.catch(() => active && setFailed(true));
		return () => {
			active = false;
		};
	}, [token, navigate]);
	if (failed) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				<p className="text-sm">This link is invalid or has expired.</p>
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
