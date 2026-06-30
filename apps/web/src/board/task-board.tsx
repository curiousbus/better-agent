import type { AgentClient } from "@curiousbus/agent-client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { loadColumns } from "./board-client";
import {
	type BoardStatus,
	type BoardStore,
	COLUMNS,
	createBoardStore,
	groupByColumn,
} from "./board-store";
import { TaskColumn } from "./task-column";

function useColumnLoader(
	store: BoardStore,
	agentClient: AgentClient,
	sessionId: string
): Set<BoardStatus> {
	const [loaded, setLoaded] = useState<Set<BoardStatus>>(new Set());
	useEffect(() => {
		let active = true;
		loadColumns(agentClient, sessionId, (status, columnTasks) => {
			if (!active) {
				return;
			}
			store.setColumn(status, columnTasks);
			setLoaded((prev) => new Set(prev).add(status));
		}).catch(() => {
			if (active) {
				toast.error("Failed to load board columns. Please refresh.");
			}
		});
		return () => {
			active = false;
		};
	}, [agentClient, sessionId, store]);
	return loaded;
}

function makeDeleteHandler(
	store: BoardStore,
	agentClient: AgentClient,
	sessionId: string
) {
	return (id: string) => {
		store.removeLocal(id);
		agentClient.runTool(sessionId, "deleteTask", { id }).catch(() => undefined);
	};
}

export function TaskBoard({
	agentClient,
	sessionId,
	onOpenTask,
}: {
	agentClient: AgentClient;
	sessionId: string;
	onOpenTask: (id: string) => void;
}) {
	const storeRef = useRef(createBoardStore());
	const store = storeRef.current;
	const tasks = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	const loaded = useColumnLoader(store, agentClient, sessionId);
	const groups = groupByColumn(tasks);
	const onDelete = makeDeleteHandler(store, agentClient, sessionId);

	return (
		<div className="flex h-full gap-4 overflow-x-auto p-4">
			{COLUMNS.map((column) => (
				<TaskColumn
					key={column.status}
					label={column.label}
					loaded={loaded.has(column.status)}
					onDelete={onDelete}
					onOpen={onOpenTask}
					status={column.status}
					tasks={groups[column.status]}
				/>
			))}
		</div>
	);
}
