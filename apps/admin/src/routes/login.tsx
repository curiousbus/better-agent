import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
	const [email, setEmail] = useState("");
	const request = useMutation(orpc.auth.requestLink.mutationOptions());
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card className="flex w-full max-w-sm flex-col gap-4 p-6">
				<div>
					<h1 className="font-semibold text-lg">Sign in</h1>
					<p className="text-muted-foreground text-sm">
						We'll email you a magic link. New here? It signs you up too.
					</p>
				</div>
				{request.isSuccess ? (
					<p className="text-sm">
						Check <span className="font-medium">{email}</span> for your sign-in
						link.
					</p>
				) : (
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							request.mutate({ email, audience: "admin" });
						}}
					>
						<Input
							aria-label="Email address"
							onChange={(event) => setEmail(event.target.value)}
							placeholder="you@example.com"
							required
							type="email"
							value={email}
						/>
						<Button disabled={request.isPending} type="submit">
							Send login link
						</Button>
					</form>
				)}
			</Card>
		</div>
	);
}
