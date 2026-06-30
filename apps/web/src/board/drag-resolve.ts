import {
	type BoardStatus,
	type BoardTask,
	COLUMNS,
	midpoint,
	sortByPosition,
} from "./board-store";

export type Container = BoardStatus | "backlog";

export interface DropTarget {
	position: number;
	sprintId: string | null;
	status: BoardStatus;
}

export function containerOf(task: BoardTask): Container {
	return task.sprintId === null ? "backlog" : task.status;
}

function resolveContainer(
	snapshot: BoardTask[],
	overId: string
): Container | null {
	if (overId === "backlog") {
		return "backlog";
	}
	const statuses = COLUMNS.map((c) => c.status) as string[];
	if (statuses.includes(overId)) {
		return overId as BoardStatus;
	}
	const overTask = snapshot.find((t) => t.id === overId);
	return overTask ? containerOf(overTask) : null;
}

function resolveDestFields(
	container: Container,
	activeSprintId: string | null
): { sprintId: string | null; status: BoardStatus } {
	if (container === "backlog") {
		return { sprintId: null, status: "todo" };
	}
	return { sprintId: activeSprintId, status: container };
}

function computePosition(
	snapshot: BoardTask[],
	overContainer: Container,
	activeId: string,
	overId: string
): number {
	const items = sortByPosition(
		snapshot.filter(
			(t) => containerOf(t) === overContainer && t.id !== activeId
		)
	);
	const overIndex = items.findIndex((t) => t.id === overId);
	const insertAt = overIndex === -1 ? items.length : overIndex;
	return midpoint(items[insertAt - 1], items[insertAt]);
}

export function resolveDrop(
	snapshot: BoardTask[],
	activeId: string,
	overId: string,
	activeSprintId: string | null
): DropTarget | null {
	const overContainer = resolveContainer(snapshot, overId);
	if (!overContainer) {
		return null;
	}
	const dest = resolveDestFields(overContainer, activeSprintId);
	const position = computePosition(snapshot, overContainer, activeId, overId);
	return { ...dest, position };
}
