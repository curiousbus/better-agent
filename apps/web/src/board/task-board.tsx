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
import { loadSprintColumns } from "./board-client";
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

interface LoaderOpts {
	activeSprintId: string | null;
	agentClient: AgentClient;
	refreshKey: number;
	sessionId: string;
	store: BoardStore;
}

function useColumnLoader(opts: LoaderOpts): Set<BoardStatus> {
	const { agentClient, sessionId, store, activeSprintId, refreshKey } = opts;
	const [loaded, setLoaded] = useState<Set<BoardStatus>>(new Set());
	useEffect(() => {
		if (!activeSprintId) {
			setLoaded(new Set());
			return () => undefined;
		}
		let active = true;
		setLoaded(new Set());
		loadSprintColumns(
			agentClient,
			sessionId,
			activeSprintId,
			(status, tasks) => {
				if (!active) {
					return;
				}
				store.setColumn(status, tasks);
				setLoaded((prev) => new Set(prev).add(status));
			}
		).catch(() => {
			if (active) {
				toast.error("Failed to load board columns. Please refresh.");
			}
		});
		return () => {
			active = false;
		};
	}, [agentClient, sessionId, store, activeSprintId, refreshKey]);
	return loaded;
}

interface BoardColumnsProps {
	loaded: Set<BoardStatus>;
	onCreate: (status: BoardStatus, title: string) => void;
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

interface TaskBoardProps {
	activeSprintId: string | null;
	agentClient: AgentClient;
	onOpenTask: (id: string) => void;
	refreshKey?: number;
	sessionId: string;
}

function useBoardState(props: TaskBoardProps) {
	const { agentClient, sessionId, activeSprintId, refreshKey = 0 } = props;
	const storeRef = useRef(createBoardStore());
	const store = storeRef.current;
	const tasks = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	const loaded = useColumnLoader({
		agentClient,
		sessionId,
		store,
		activeSprintId,
		refreshKey,
	});
	const handlers = useBoardHandlers(
		store,
		agentClient,
		sessionId,
		activeSprintId
	);
	return { tasks, loaded, handlers };
}

export function TaskBoard(props: TaskBoardProps) {
	const { activeSprintId, onOpenTask } = props;
	const { tasks, loaded, handlers } = useBoardState(props);
	const { onDragEnd, onDragOver, onCreate, onDelete } = handlers;
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: ACTIVATION_DISTANCE },
		})
	);

	if (!activeSprintId) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-muted-foreground text-sm">
					Start a sprint to begin.
				</p>
			</div>
		);
	}

	return (
		<DndContext
			collisionDetection={closestCorners}
			onDragEnd={onDragEnd}
			onDragOver={onDragOver}
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
