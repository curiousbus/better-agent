/** A tiny localStorage-backed todo store, shared by the interactive TodoList
 * widget AND the agent's client tools — so conversational edits ("add buy milk")
 * and in-widget edits (click delete) mutate the same data and stay in sync. */

export interface Todo {
	done: boolean;
	id: string;
	title: string;
}

const KEY = "genui_todos";
const listeners = new Set<() => void>();

function load(): Todo[] {
	if (typeof localStorage === "undefined") {
		return [];
	}
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Todo[]) : [];
	} catch {
		return [];
	}
}

// In-memory cache is the snapshot source (stable reference for useSyncExternalStore).
let cache: Todo[] = load();

function commit(next: Todo[]): Todo[] {
	cache = next;
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(KEY, JSON.stringify(next));
	}
	for (const listener of listeners) {
		listener();
	}
	return next;
}

export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getTodos(): Todo[] {
	return cache;
}

export function addTodo(title: string): Todo[] {
	const trimmed = title.trim();
	if (trimmed === "") {
		return cache;
	}
	return commit([
		{ id: crypto.randomUUID(), title: trimmed, done: false },
		...cache,
	]);
}

export function toggleTodo(id: string): Todo[] {
	return commit(cache.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
}

export function editTodo(id: string, title: string): Todo[] {
	const trimmed = title.trim();
	if (trimmed === "") {
		return cache;
	}
	return commit(cache.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
}

export function removeTodo(id: string): Todo[] {
	return commit(cache.filter((t) => t.id !== id));
}

export function clearDone(): Todo[] {
	return commit(cache.filter((t) => !t.done));
}
