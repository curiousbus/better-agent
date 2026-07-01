import { Input } from "@better-agent/ui/components/input";
import type { AgentClient } from "@curiousbus/agent-client";
import {
	type CollisionDetection,
	closestCorners,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { SearchIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { loadSprintColumns } from "./board-client";
import {
	type BoardStatus,
	type BoardStore,
	type BoardTask,
	COLUMNS,
	groupByColumn,
} from "./board-store";
import { TaskCardOverlay } from "./task-card";
import { TaskColumn } from "./task-column";
import { useBoardHandlers } from "./use-board-handlers";

const ACTIVATION_DISTANCE = 4;

// Pointer-first collision keeps cross-column drag stable (pure closestCorners
// oscillates near column boundaries); fall back to corners when the pointer is
// outside every droppable.
const boardCollision: CollisionDetection = (args) => {
	const pointer = pointerWithin(args);
	return pointer.length > 0 ? pointer : closestCorners(args);
};

const MEASURING = {
	droppable: { strategy: MeasuringStrategy.Always },
} as const;

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

function matchesSearch(task: BoardTask, query: string): boolean {
	if (query === "") {
		return true;
	}
	const q = query.toLowerCase();
	return task.title.toLowerCase().includes(q) || `task-${task.seq}`.includes(q);
}

function BoardToolbar({
	search,
	onSearch,
}: {
	onSearch: (v: string) => void;
	search: string;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 px-4 pt-3">
			<div className="relative w-full max-w-xs">
				<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="pl-8"
					onChange={(e) => onSearch(e.target.value)}
					placeholder="Search tasks…"
					value={search}
				/>
			</div>
		</div>
	);
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
		<div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto p-4">
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
	store: BoardStore;
}

function useBoardState(props: TaskBoardProps) {
	const {
		agentClient,
		sessionId,
		activeSprintId,
		refreshKey = 0,
		store,
	} = props;
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	const loaderOpts: LoaderOpts = {
		agentClient,
		sessionId,
		store,
		activeSprintId,
		refreshKey,
	};
	const columnsLoaded = useColumnLoader(loaderOpts);
	const handlers = useBoardHandlers(
		store,
		agentClient,
		sessionId,
		activeSprintId
	);
	return { snapshot, columnsLoaded, handlers };
}

interface DndShellProps {
	children: React.ReactNode;
	onDragCancel: () => void;
	onDragEnd: Parameters<typeof DndContext>[0]["onDragEnd"];
	onDragStart: (event: DragStartEvent) => void;
	overlay: React.ReactNode;
	sensors: ReturnType<typeof useSensors>;
}

function DndShell({
	children,
	onDragCancel,
	onDragEnd,
	onDragStart,
	overlay,
	sensors,
}: DndShellProps) {
	return (
		<DndContext
			collisionDetection={boardCollision}
			measuring={MEASURING}
			onDragCancel={onDragCancel}
			onDragEnd={onDragEnd}
			onDragStart={onDragStart}
			sensors={sensors}
		>
			<div className="flex h-full flex-col">{children}</div>
			{/* Portal to <body> so the overlay's fixed positioning escapes the
			    route-transition motion.div (a transform/filter ancestor breaks
			    position:fixed and offsets the card from the cursor). */}
			{typeof document === "undefined"
				? null
				: createPortal(<DragOverlay>{overlay}</DragOverlay>, document.body)}
		</DndContext>
	);
}

// Tracks the dragged card so a <DragOverlay> clone can follow the cursor
// smoothly (cross-column moves otherwise snap because onDragOver mutates data).
function useDragOverlay(
	snapshot: BoardTask[],
	onDragEnd: DndShellProps["onDragEnd"]
) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const activeTask = snapshot.find((t) => t.id === activeId) ?? null;
	return {
		overlay: activeTask ? <TaskCardOverlay task={activeTask} /> : null,
		onDragStart: (event: DragStartEvent) =>
			setActiveId(String(event.active.id)),
		onDragCancel: () => setActiveId(null),
		onDragEnd: (event: DragEndEvent) => {
			setActiveId(null);
			onDragEnd?.(event);
		},
	};
}

export function TaskBoard(props: TaskBoardProps) {
	const { activeSprintId, onOpenTask } = props;
	const { snapshot, columnsLoaded, handlers } = useBoardState(props);
	const { onDragEnd, onCreate, onDelete } = handlers;
	const [search, setSearch] = useState("");
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: ACTIVATION_DISTANCE },
		})
	);
	const drag = useDragOverlay(snapshot, onDragEnd);
	const sprintTasks = snapshot.filter(
		(t) => t.sprintId !== null && matchesSearch(t, search)
	);
	const shellProps = { ...drag, sensors };

	if (!activeSprintId) {
		return (
			<DndShell {...shellProps}>
				<div className="flex flex-1 items-center justify-center">
					<p className="text-muted-foreground text-sm">
						Start a sprint to begin.
					</p>
				</div>
			</DndShell>
		);
	}

	return (
		<DndShell {...shellProps}>
			<BoardToolbar onSearch={setSearch} search={search} />
			<BoardColumns
				loaded={columnsLoaded}
				onCreate={onCreate}
				onDelete={onDelete}
				onOpenTask={onOpenTask}
				tasks={groupByColumn(sprintTasks)}
			/>
		</DndShell>
	);
}
