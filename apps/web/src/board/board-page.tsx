import { buttonVariants } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useMemo,
	useState,
} from "react";
import { GENUI_CHAT_CONFIG } from "@/genui/config";
import { userAgentClient } from "@/utils/chat-client";
import { orpc } from "@/utils/orpc";
import { BoardChat } from "./board-chat";
import { loadBoardSessionId, saveBoardSessionId } from "./board-session";
import { TaskBoard } from "./task-board";
import { TaskModal } from "./task-modal";

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
			<Link className={buttonVariants({ variant: "default" })} to="/">
				Create an agent
			</Link>
		</div>
	);
}

// The board needs a user-session as a carrier for the tool stream; any of the
// user's agents works (tasks are user-scoped, not agent-scoped). Pick the first
// agent, build its client, and open one session.
function useBoardClient() {
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
		const stored = loadBoardSessionId();
		if (stored) {
			setSessionId(stored);
			return () => undefined;
		}
		let active = true;
		agentClient
			.createSession()
			.then((s) => {
				if (active) {
					saveBoardSessionId(s.sessionId);
					setSessionId(s.sessionId);
				}
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [agentClient]);
	return { agent, agentClient, sessionId, pending: agentsQuery.isPending };
}

function useBoardGenui(
	setOpenTaskId: (id: string) => void,
	setRefreshKey: Dispatch<SetStateAction<number>>
) {
	return useMemo(
		() => ({
			...GENUI_CHAT_CONFIG,
			handlers: {
				...GENUI_CHAT_CONFIG.handlers,
				openTask: (payload: unknown) => {
					const id = (payload as { id?: string }).id;
					if (id) {
						setOpenTaskId(id);
						setRefreshKey((k) => k + 1);
					}
				},
			},
		}),
		[setOpenTaskId, setRefreshKey]
	);
}

export function BoardPage() {
	const { agent, agentClient, sessionId, pending } = useBoardClient();
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const boardGenui = useBoardGenui(setOpenTaskId, setRefreshKey);

	if (pending || (agent && sessionId === "")) {
		return <BoardLoading />;
	}
	if (!(agent && agentClient)) {
		return <BoardEmpty />;
	}
	return (
		<>
			<TaskBoard
				agentClient={agentClient}
				key={refreshKey}
				onOpenTask={setOpenTaskId}
				sessionId={sessionId}
			/>
			<TaskModal
				agentClient={agentClient}
				onClose={() => setOpenTaskId(null)}
				onSaved={() => setRefreshKey((k) => k + 1)}
				sessionId={sessionId}
				taskId={openTaskId}
			/>
			<BoardChat
				agentClient={agentClient}
				generativeUI={boardGenui}
				sessionId={sessionId}
			/>
		</>
	);
}
