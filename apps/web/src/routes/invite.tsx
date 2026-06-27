import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/invite")({ component: InvitePage });

function InvitePage() {
	const [code, setCode] = useState("");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const redeem = useMutation(
		orpc.invite.redeem.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.invite.status.key() });
				navigate({ to: "/" });
			},
		})
	);

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<form
				className="flex w-full max-w-sm flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					redeem.mutate({ code });
				}}
			>
				<div>
					<h1 className="font-semibold text-lg">Enter your invite code</h1>
					<p className="text-muted-foreground text-sm">
						Access is invite-only. Enter the code you were given to continue.
					</p>
				</div>
				<Input
					aria-label="Invite code"
					onChange={(event) => setCode(event.target.value)}
					placeholder="Invite code"
					required
					value={code}
				/>
				{redeem.error ? (
					<p className="text-destructive text-sm">{redeem.error.message}</p>
				) : null}
				<Button disabled={redeem.isPending} type="submit">
					Continue
				</Button>
			</form>
		</div>
	);
}
