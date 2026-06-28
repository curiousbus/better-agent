import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "@/utils/orpc";

export function VerifyEmailBanner() {
	const me = useQuery(orpc.auth.me.queryOptions());
	const [sent, setSent] = useState(false);

	const resend = useMutation({
		...orpc.auth.requestLink.mutationOptions(),
		onSuccess: () => {
			setSent(true);
		},
	});

	if (me.isPending || me.isError || me.data?.emailVerified !== false) {
		return null;
	}

	return (
		<div className="flex shrink-0 flex-col items-start justify-between gap-2 bg-muted px-4 py-2 text-sm sm:flex-row sm:items-center">
			<span className="min-w-0">
				Verify your email — check{" "}
				<span className="break-all font-medium">{me.data.email}</span> for a
				link.
			</span>
			{sent ? (
				<span className="text-muted-foreground">Sent — check your inbox</span>
			) : (
				<Button
					disabled={resend.isPending}
					onClick={() => resend.mutate({ email: me.data.email })}
					size="sm"
					variant="outline"
				>
					Resend
				</Button>
			)}
		</div>
	);
}
