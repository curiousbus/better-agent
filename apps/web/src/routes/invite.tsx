import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TicketIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/invite")({ component: InvitePage });

// Vertical bars for the stub — inline style avoids a Tailwind arbitrary value.
const BARCODE_STYLE = {
	backgroundImage:
		"repeating-linear-gradient(to right, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 5px)",
};

function useRedeem() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useMutation(
		orpc.invite.redeem.mutationOptions({
			onSuccess: () => {
				// Optimistically mark authorized so the home route's gate doesn't read
				// stale (authorized:false) cache and bounce us back to /invite.
				queryClient.setQueryData(orpc.invite.status.key(), {
					required: true,
					authorized: true,
				});
				navigate({ to: "/" });
			},
		})
	);
}

// The tear-off edge: a dashed perforation with a notch bitten out of the top and
// bottom edges (filled with the page background so it reads as a cut-out).
function Perforation() {
	return (
		<div className="relative hidden self-stretch border-border border-l-2 border-dashed sm:block">
			<span className="absolute -top-3 -left-3 size-6 rounded-full bg-muted" />
			<span className="absolute -bottom-3 -left-3 size-6 rounded-full bg-muted" />
		</div>
	);
}

function Stub() {
	return (
		<div className="hidden w-20 shrink-0 flex-col items-center justify-center gap-3 py-6 sm:flex">
			<div
				aria-hidden="true"
				className="h-16 w-9 text-foreground/80"
				style={BARCODE_STYLE}
			/>
			<span className="font-medium text-muted-foreground text-xs tracking-widest">
				ADMIT
			</span>
		</div>
	);
}

function TicketForm() {
	const [code, setCode] = useState("");
	const redeem = useRedeem();
	return (
		<form
			className="flex flex-1 flex-col gap-4 p-7"
			onSubmit={(event) => {
				event.preventDefault();
				redeem.mutate({ code });
			}}
		>
			<div className="flex items-center gap-2 text-muted-foreground">
				<TicketIcon className="size-4" />
				<span className="font-semibold text-xs tracking-widest">ADMIT ONE</span>
			</div>
			<div>
				<h1 className="font-semibold text-lg">Enter your invite code</h1>
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
	);
}

function InvitePage() {
	return (
		<div className="flex flex-1 items-center justify-center bg-muted p-4 sm:p-6">
			<div className="flex w-full max-w-md rounded-xl border bg-card shadow-md sm:max-w-xl">
				<TicketForm />
				<Perforation />
				<Stub />
			</div>
		</div>
	);
}
