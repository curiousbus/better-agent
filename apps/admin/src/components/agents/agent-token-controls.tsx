import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { saveAgentToken } from "@/utils/agent-token";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function useRotateToken(onRotated: (token: string) => void) {
	return useMutation(
		orpc.agents.rotateToken.mutationOptions({
			onSuccess: (result) => {
				saveAgentToken(result.agent.id, result.token);
				onRotated(result.token);
			},
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
			<PopoverTrigger render={<Button size="sm" variant="ghost" />}>
				Token
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
			<div>
				<p className="font-medium text-lg">Chat with {agent.name}</p>
				<p className="max-w-sm text-muted-foreground text-sm">
					This agent has no token cached in this browser. Generate one to start
					chatting — it's shown once and stored locally.
				</p>
			</div>
			<Button
				disabled={rotate.isPending}
				onClick={() => rotate.mutate({ id: agent.id })}
			>
				Generate token
			</Button>
		</div>
	);
}
