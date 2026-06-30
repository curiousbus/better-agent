import type { AgentClient } from "@curiousbus/agent-client";
import {
	closestCorners,
	DndContext,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
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
import { useBoardHandlers } from "./use-board-handlers";

const ACTIVATION_DISTANCE = 4;

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

interface BoardColumnsProps {
	loaded: Set<BoardStatus>;
	onCreate: (status: BoardStatus) => void;
	onDelete: (id: string) => void;
	onOpenTask: (id: string) => void;
	tasks: ReturnType<typeof groupByColumn>;
}

function BoardColumns({
	loaded,
	tasks,
	onCreate,
	onDelete,
	onOpenTask,
}: BoardColumnsProps) {
	return (
		<div className="flex h-full gap-4 overflow-x-auto p-4">
			{COLUMNS.map((column) => (
				<TaskColumn
					key={column.status}
					label={column.label}
					loaded={loaded.has(column.status)}
					onCreate={onCreate}
					onDelete={onDelete}
					onOpen={onOpenTask}
					status={column.status}
					tasks={tasks[column.status]}
				/>
			))}
		</div>
	);
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
	const { onDragEnd, onCreate, onDelete } = useBoardHandlers(
		store,
		agentClient,
		sessionId
	);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: ACTIVATION_DISTANCE },
		})
	);
	return (
		<DndContext
			collisionDetection={closestCorners}
			onDragEnd={onDragEnd}
			sensors={sensors}
		>
			<BoardColumns
				loaded={loaded}
				onCreate={onCreate}
				onDelete={onDelete}
				onOpenTask={onOpenTask}
				tasks={groupByColumn(tasks)}
			/>
		</DndContext>
	);
}
