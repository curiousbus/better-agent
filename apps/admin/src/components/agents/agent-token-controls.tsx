import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RevealText } from "@/components/reveal-text";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function useRotateToken(onRotated: (token: string) => void) {
	return useMutation(
		orpc.agents.rotateToken.mutationOptions({
			// The server persists the rotated token; just surface it for copy.
			onSuccess: (result) => onRotated(result.token),
			onError: (error) => toast.error(error.message),
		})
	);
}

export function RegenerateToken({
	agentId,
	onToken,
}: {
	agentId: string;
	onToken: (token: string) => void;
}) {
	const rotate = useRotateToken(onToken);
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<Button
						aria-label="Regenerate token"
						size="icon-xs"
						variant="ghost"
					/>
				}
			>
				<RotateCwIcon className="size-3.5" />
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">
					Regenerate token? Any external client using the old token will stop
					working.
				</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						disabled={rotate.isPending}
						onClick={() => {
							setOpen(false);
							rotate.mutate({ id: agentId });
						}}
						size="xs"
					>
						Regenerate
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function GenerateTokenState({
	agent,
	onToken,
}: {
	agent: AgentRow;
	onToken: (token: string) => void;
}) {
	const rotate = useRotateToken(onToken);
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<RevealText>
				<p className="t-stagger-line t-stagger-line--1 font-medium text-lg">
					Chat with {agent.name}
				</p>
				<p className="t-stagger-line t-stagger-line--2 max-w-sm text-muted-foreground text-sm">
					This agent doesn't have a token yet. Generate one to start chatting —
					it's stored with the agent and reused automatically.
				</p>
			</RevealText>
			<Button
				disabled={rotate.isPending}
				onClick={() => rotate.mutate({ id: agent.id })}
			>
				Generate token
			</Button>
		</div>
	);
}
