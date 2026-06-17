import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

function AgentSelector({
	value,
	onChange,
}: {
	value: string;
	onChange: (id: string) => void;
}) {
	const agents = useQuery(orpc.agents.list.queryOptions());
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="session-agent">Agent</Label>
			<Select
				onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
				value={value}
			>
				<SelectTrigger className="w-full" id="session-agent">
					<SelectValue placeholder="Select an agent…" />
				</SelectTrigger>
				<SelectContent>
					{(agents.data ?? []).map((agent) => (
						<SelectItem key={agent.id} value={agent.id}>
							{agent.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function DialogActions({
	agentId,
	isPending,
	onCancel,
	onSubmit,
}: {
	agentId: string;
	isPending: boolean;
	onCancel: () => void;
	onSubmit: () => void;
}) {
	return (
		<div className="flex justify-end gap-2">
			<Button onClick={onCancel} size="sm" variant="outline">
				Cancel
			</Button>
			<Button
				disabled={agentId === "" || isPending}
				onClick={onSubmit}
				size="sm"
			>
				Create
			</Button>
		</div>
	);
}

export function NewSessionDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (sessionId: string) => void;
}) {
	const queryClient = useQueryClient();
	const [agentId, setAgentId] = useState("");
	const create = useMutation(
		orpc.sessions.create.mutationOptions({
			onSuccess: (session) => {
				toast.success("Session created");
				queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
				onCreated(session.id);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New session</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<AgentSelector onChange={setAgentId} value={agentId} />
					<DialogActions
						agentId={agentId}
						isPending={create.isPending}
						onCancel={() => onOpenChange(false)}
						onSubmit={() => create.mutate({ agentId })}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
