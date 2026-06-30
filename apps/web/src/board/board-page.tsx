import { buttonVariants } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { userAgentClient } from "@/utils/chat-client";
import { orpc } from "@/utils/orpc";
import { TaskBoard } from "./task-board";

function BoardLoading() {
	return (
		<div className="flex h-full items-center justify-center p-8">
			<div className="flex w-full max-w-4xl gap-4">
				<Skeleton className="h-48 flex-1 rounded-lg" />
				<Skeleton className="h-48 flex-1 rounded-lg" />
				<Skeleton className="h-48 flex-1 rounded-lg" />
			</div>
		</div>
	);
}

function BoardEmpty() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 p-8">
			<p className="text-muted-foreground text-sm">
				Create an agent to use the board.
			</p>
			<a className={buttonVariants({ variant: "default" })} href="/agents/new">
				Create agent
			</a>
		</div>
	);
}

export function BoardPage() {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions());
	const agent = agentsQuery.data?.[0] ?? null;
	const agentClient = useMemo(
		() => (agent ? userAgentClient(agent.id) : null),
		[agent]
	);
	const [sessionId, setSessionId] = useState("");
	useEffect(() => {
		if (!agentClient) {
			return () => undefined;
		}
		let active = true;
		agentClient
			.createSession()
			.then((s) => {
				if (active) {
					setSessionId(s.sessionId);
				}
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [agentClient]);
	// openTaskId is wired to the modal in Task 9; reserve the setter only for now.
	const [, setOpenTaskId] = useState<string | null>(null);

	if (agentsQuery.isPending || (agent && sessionId === "")) {
		return <BoardLoading />;
	}
	if (!agent) {
		return <BoardEmpty />;
	}
	if (!agentClient) {
		return <BoardLoading />;
	}
	return (
		<TaskBoard
			agentClient={agentClient}
			onOpenTask={setOpenTaskId}
			sessionId={sessionId}
		/>
	);
}
