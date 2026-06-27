import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TicketIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/invite")({ component: InvitePage });

function useRedeem() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useMutation(
		orpc.invite.redeem.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.invite.status.key() });
				navigate({ to: "/" });
			},
		})
	);
}

// The ticket stub + its perforated edge (with notch cut-outs).
function TicketEdge() {
	return (
		<>
			<div className="flex w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-l-xl bg-primary p-4 text-primary-foreground">
				<TicketIcon className="size-7" />
				<span className="font-medium text-xs tracking-widest">INVITE</span>
			</div>
			<div className="relative border-border border-l border-dashed">
				<span className="absolute -top-2 -left-2 size-4 rounded-full bg-background" />
				<span className="absolute -bottom-2 -left-2 size-4 rounded-full bg-background" />
			</div>
		</>
	);
}

function InvitePage() {
	const [code, setCode] = useState("");
	const redeem = useRedeem();

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<div className="relative flex w-full max-w-lg overflow-visible rounded-xl border bg-card shadow-sm">
				<TicketEdge />
				<form
					className="flex flex-1 flex-col gap-4 p-6"
					onSubmit={(event) => {
						event.preventDefault();
						redeem.mutate({ code });
					}}
				>
					<div>
						<h1 className="font-semibold text-base">Enter your invite code</h1>
						<p className="text-muted-foreground text-sm">
							Access is invite-only — enter the code you were given.
						</p>
					</div>
					<Input
						aria-label="Invite code"
						className="font-mono tracking-wider"
						onChange={(event) => setCode(event.target.value)}
						placeholder="XXXX-XXXX"
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
		</div>
	);
}
