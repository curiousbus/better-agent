import { buttonVariants } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { userAgentClient } from "@/utils/chat-client";
import { orpc } from "@/utils/orpc";
import { BoardCommandBar } from "./board-command-bar";
import { loadBoardSessionId, saveBoardSessionId } from "./board-session";
import { createBoardStore } from "./board-store";
import { SprintBar } from "./sprint-bar";
import { TaskBoard } from "./task-board";
import { TaskModal } from "./task-modal";
import { useSprints } from "./use-sprints";

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

type ReadyClient = NonNullable<
	ReturnType<typeof useBoardClient>["agentClient"]
>;

function useSprintActions(
	sprintHook: ReturnType<typeof useSprints>,
	setRefreshKey: Dispatch<SetStateAction<number>>
) {
	const bump = useCallback(() => {
		sprintHook.refresh();
		setRefreshKey((k) => k + 1);
	}, [sprintHook, setRefreshKey]);
	const onComplete = useCallback(
		async (id: string) => {
			await sprintHook.completeSprint(id);
			bump();
		},
		[sprintHook, bump]
	);
	const onCreate = useCallback(
		async (name: string, goal?: string) => {
			await sprintHook.createSprint(name, goal);
			bump();
		},
		[sprintHook, bump]
	);
	const onStart = useCallback(
		async (id: string) => {
			await sprintHook.startSprint(id);
			bump();
		},
		[sprintHook, bump]
	);
	return { bump, onComplete, onCreate, onStart };
}

interface BoardContentProps {
	agentClient: ReadyClient;
	openTaskId: string | null;
	refreshKey: number;
	sessionId: string;
	setOpenTaskId: (id: string | null) => void;
	setRefreshKey: Dispatch<SetStateAction<number>>;
}

// One shared board store: the board renders from it AND the command bar reads
// the current tasks from it to give the agent real board context.
function useSharedBoardStore() {
	const storeRef = useRef(createBoardStore());
	const store = storeRef.current;
	const tasks = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	return { store, tasks };
}

function BoardContent(props: BoardContentProps) {
	const { agentClient, openTaskId, sessionId, setOpenTaskId, setRefreshKey } =
		props;
	const sprintHook = useSprints(agentClient, sessionId);
	const { bump, onComplete, onCreate, onStart } = useSprintActions(
		sprintHook,
		setRefreshKey
	);
	const { store, tasks } = useSharedBoardStore();
	const activeSprintId = sprintHook.active?.id ?? null;

	return (
		<>
			<SprintBar
				active={sprintHook.active}
				loading={sprintHook.loading}
				onComplete={onComplete}
				onCreate={onCreate}
				onStart={onStart}
				sprints={sprintHook.sprints}
			/>
			<TaskBoard
				activeSprintId={activeSprintId}
				agentClient={agentClient}
				onOpenTask={setOpenTaskId}
				refreshKey={props.refreshKey}
				sessionId={sessionId}
				store={store}
			/>
			<BoardCommandBar
				activeSprintName={sprintHook.active?.name ?? null}
				agentClient={agentClient}
				onDone={bump}
				sessionId={sessionId}
				tasks={tasks}
			/>
			<TaskModal
				activeSprintId={activeSprintId}
				agentClient={agentClient}
				onClose={() => setOpenTaskId(null)}
				onSaved={() => setRefreshKey((k) => k + 1)}
				sessionId={sessionId}
				sprints={sprintHook.sprints}
				taskId={openTaskId}
			/>
		</>
	);
}

export function BoardPage() {
	const { agent, agentClient, sessionId, pending } = useBoardClient();
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	if (pending || (agent && sessionId === "")) {
		return <BoardLoading />;
	}
	if (!(agent && agentClient)) {
		return <BoardEmpty />;
	}
	return (
		<BoardContent
			agentClient={agentClient}
			openTaskId={openTaskId}
			refreshKey={refreshKey}
			sessionId={sessionId}
			setOpenTaskId={setOpenTaskId}
			setRefreshKey={setRefreshKey}
		/>
	);
}
