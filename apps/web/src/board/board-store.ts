export type BoardStatus = "todo" | "in_progress" | "done";

export interface BoardTask {
	description: string;
	id: string;
	position: number;
	status: BoardStatus;
	title: string;
}

export const COLUMNS: readonly { label: string; status: BoardStatus }[] = [
	{ status: "todo", label: "To Do" },
	{ status: "in_progress", label: "In Progress" },
	{ status: "done", label: "Done" },
];

const POSITION_GAP = 1;
const HALF = 2;

export function sortByPosition(tasks: BoardTask[]): BoardTask[] {
	return [...tasks].sort((a, b) => a.position - b.position);
}

export function groupByColumn(
	tasks: BoardTask[]
): Record<BoardStatus, BoardTask[]> {
	const groups: Record<BoardStatus, BoardTask[]> = {
		todo: [],
		in_progress: [],
		done: [],
	};
	for (const task of tasks) {
		groups[task.status].push(task);
	}
	for (const status of Object.keys(groups) as BoardStatus[]) {
		groups[status] = sortByPosition(groups[status]);
	}
	return groups;
}

export function nextPosition(column: BoardTask[]): number {
	return column.reduce((m, t) => Math.max(m, t.position), 0) + POSITION_GAP;
}

/** Fractional position between two neighbors (drag-drop target). */
export function midpoint(before?: BoardTask, after?: BoardTask): number {
	if (before && after) {
		return (before.position + after.position) / HALF;
	}
	if (before) {
		return before.position + POSITION_GAP;
	}
	if (after) {
		return after.position - POSITION_GAP;
	}
	return POSITION_GAP;
}

export function createBoardStore() {
	let cache: BoardTask[] = [];
	const listeners = new Set<() => void>();
	const emit = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	const set = (next: BoardTask[]) => {
		cache = next;
		emit();
	};
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => cache,
		setColumn(status: BoardStatus, tasks: BoardTask[]) {
			set([...cache.filter((t) => t.status !== status), ...tasks]);
		},
		addLocal(task: BoardTask) {
			set([...cache, task]);
		},
		replaceLocal(id: string, task: BoardTask) {
			set(cache.map((t) => (t.id === id ? task : t)));
		},
		applyMove(id: string, status: BoardStatus, position: number) {
			set(cache.map((t) => (t.id === id ? { ...t, status, position } : t)));
		},
		removeLocal(id: string) {
			set(cache.filter((t) => t.id !== id));
		},
	};
}

export type BoardStore = ReturnType<typeof createBoardStore>;
