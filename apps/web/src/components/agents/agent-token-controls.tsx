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
