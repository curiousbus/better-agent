import type { AgentClient } from "@curiousbus/agent-client";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { loadColumns, parseTask } from "./board-client";
import {
	type BoardStatus,
	type BoardStore,
	groupByColumn,
	nextPosition,
} from "./board-store";
import { containerOf, resolveDrop } from "./drag-resolve";

interface HandlerCtx {
	activeSprintId: string | null;
	agentClient: AgentClient;
	sessionId: string;
	store: BoardStore;
}

// TODO (Task 10): thread active sprint id via ctx and pass sprintId to createTask
function applyCreate(
	ctx: HandlerCtx,
	status: BoardStatus,
	title: string
): void {
	if (title.trim() === "") {
		return;
	}
	const { store, agentClient, sessionId } = ctx;
	const trimmed = title.trim();
	const tempId = `temp-${crypto.randomUUID()}`;
	const groups = groupByColumn(store.getSnapshot());
	store.addLocal({
		id: tempId,
		title: trimmed,
		description: "",
		status,
		position: nextPosition(groups[status]),
		seq: 0,
		sprintId: null,
	});
	agentClient
		.runTool(sessionId, "createTask", { title: trimmed, status })
		.then((result) => store.replaceLocal(tempId, parseTask(result)))
		.catch(() => {
			store.removeLocal(tempId);
			toast.error("Could not create task.");
		});
}

function applyDragOver(event: DragOverEvent, ctx: HandlerCtx): void {
	const { active, over } = event;
	if (!over) {
		return;
	}
	const { store, activeSprintId } = ctx;
	const activeId = String(active.id);
	const overId = String(over.id);
	const snapshot = store.getSnapshot();
	const activeTask = snapshot.find((t) => t.id === activeId);
	if (!activeTask) {
		return;
	}
	const target = resolveDrop(snapshot, activeId, overId, activeSprintId);
	if (!target) {
		return;
	}
	// Guard: only move when the container actually changes (avoid same-container thrash)
	const currentContainer = containerOf(activeTask);
	const targetContainer: string =
		target.sprintId === null ? "backlog" : target.status;
	if (currentContainer === targetContainer) {
		return;
	}
	store.applyMove(activeId, target);
}

function applyDragEnd(event: DragEndEvent, ctx: HandlerCtx): void {
	const { active } = event;
	const { store, agentClient, sessionId } = ctx;
	const activeId = String(active.id);
	const snapshot = store.getSnapshot();
	const current = snapshot.find((t) => t.id === activeId);
	if (!current) {
		return;
	}
	const { sprintId, status, position } = current;
	agentClient
		.runTool(sessionId, "moveTask", {
			id: activeId,
			sprintId,
			status,
			position,
		})
		.catch(() => {
			toast.error("Failed to move task.");
			loadColumns(agentClient, sessionId, (s, tasks) =>
				store.setColumn(s, tasks)
			);
		});
}

export function useBoardHandlers(
	store: BoardStore,
	agentClient: AgentClient,
	sessionId: string,
	activeSprintId: string | null
) {
	const ctx: HandlerCtx = useMemo(
		() => ({ store, agentClient, sessionId, activeSprintId }),
		[store, agentClient, sessionId, activeSprintId]
	);

	const onDragOver = useCallback(
		(event: DragOverEvent) => applyDragOver(event, ctx),
		[ctx]
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => applyDragEnd(event, ctx),
		[ctx]
	);

	const onCreate = useCallback(
		(status: BoardStatus, title: string) => applyCreate(ctx, status, title),
		[ctx]
	);

	const onDelete = useCallback(
		(id: string) => {
			const previous = store.getSnapshot().find((t) => t.id === id);
			store.removeLocal(id);
			agentClient.runTool(sessionId, "deleteTask", { id }).catch(() => {
				if (previous) {
					store.addLocal(previous);
				}
				toast.error("Failed to delete task.");
			});
		},
		[store, agentClient, sessionId]
	);

	return { onDragEnd, onDragOver, onCreate, onDelete };
}
