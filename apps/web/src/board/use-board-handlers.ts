import type { AgentClient } from "@curiousbus/agent-client";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { loadSprintColumns, parseTask } from "./board-client";
import { type BoardStatus, type BoardStore, nextPosition } from "./board-store";
import { containerOf, resolveDrop } from "./drag-resolve";

interface HandlerCtx {
	activeSprintId: string | null;
	agentClient: AgentClient;
	sessionId: string;
	store: BoardStore;
}

interface CreateOpts {
	sprintId: string | null;
	status: BoardStatus;
}

function optimisticCreate(
	ctx: HandlerCtx,
	opts: CreateOpts,
	title: string
): void {
	if (title.trim() === "") {
		return;
	}
	const { store, agentClient, sessionId } = ctx;
	const { status, sprintId } = opts;
	const trimmed = title.trim();
	const tempId = `temp-${crypto.randomUUID()}`;
	const bucket = store
		.getSnapshot()
		.filter((t) => t.sprintId === sprintId && t.status === status);
	store.addLocal({
		id: tempId,
		title: trimmed,
		description: "",
		status,
		position: nextPosition(bucket),
		seq: 0,
		sprintId,
	});
	agentClient
		.runTool(sessionId, "createTask", { title: trimmed, status, sprintId })
		.then((result) => store.replaceLocal(tempId, parseTask(result)))
		.catch(() => {
			store.removeLocal(tempId);
			toast.error("Could not create task.");
		});
}

function applyCreate(
	ctx: HandlerCtx,
	status: BoardStatus,
	title: string
): void {
	optimisticCreate(ctx, { status, sprintId: ctx.activeSprintId }, title);
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
	const { active, over } = event;
	if (!over) {
		return;
	}
	const { store, agentClient, sessionId, activeSprintId } = ctx;
	const activeId = String(active.id);
	// onDragEnd is the source of truth for the final position: onDragOver only
	// applies CROSS-container moves live, so a same-column reorder would otherwise
	// persist the stale pre-drag position. Recompute from the drop target.
	const target = resolveDrop(
		store.getSnapshot(),
		activeId,
		String(over.id),
		activeSprintId
	);
	if (!target) {
		return;
	}
	store.applyMove(activeId, target);
	agentClient
		.runTool(sessionId, "moveTask", {
			id: activeId,
			sprintId: target.sprintId,
			status: target.status,
			position: target.position,
		})
		.catch(() => {
			toast.error("Failed to move task.");
			// Revert by reloading the active sprint's columns from the server.
			if (activeSprintId) {
				loadSprintColumns(agentClient, sessionId, activeSprintId, (s, tasks) =>
					store.setColumn(s, tasks)
				);
			}
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

	const onCreateBacklog = useCallback(
		(title: string) =>
			optimisticCreate(ctx, { status: "todo", sprintId: null }, title),
		[ctx]
	);

	return { onDragEnd, onDragOver, onCreate, onDelete, onCreateBacklog };
}
