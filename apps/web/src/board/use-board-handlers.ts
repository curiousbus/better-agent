import type { AgentClient } from "@curiousbus/agent-client";
import type { DragEndEvent } from "@dnd-kit/core";
import { useCallback } from "react";
import { toast } from "sonner";
import { loadColumns, parseTask } from "./board-client";
import {
	type BoardStatus,
	type BoardStore,
	COLUMNS,
	groupByColumn,
	midpoint,
	nextPosition,
} from "./board-store";

interface HandlerCtx {
	agentClient: AgentClient;
	sessionId: string;
	store: BoardStore;
}

function resolveDestStatus(
	store: BoardStore,
	overId: string
): BoardStatus | null {
	const statuses = COLUMNS.map((c) => c.status);
	if ((statuses as string[]).includes(overId)) {
		return overId as BoardStatus;
	}
	return store.getSnapshot().find((t) => t.id === overId)?.status ?? null;
}

function applyDragEnd(
	event: DragEndEvent,
	store: BoardStore,
	agentClient: AgentClient,
	sessionId: string
): void {
	const { active, over } = event;
	if (!over) {
		return;
	}
	const activeId = String(active.id);
	const overId = String(over.id);
	const destStatus = resolveDestStatus(store, overId);
	if (!destStatus) {
		return;
	}
	const groups = groupByColumn(store.getSnapshot());
	const column = groups[destStatus].filter((t) => t.id !== activeId);
	const overIndex = column.findIndex((t) => t.id === overId);
	const insertAt = overIndex === -1 ? column.length : overIndex;
	const position = midpoint(column[insertAt - 1], column[insertAt]);
	const current = store.getSnapshot().find((t) => t.id === activeId);
	if (
		current &&
		current.status === destStatus &&
		current.position === position
	) {
		return;
	}
	store.applyMove(activeId, destStatus, position);
	agentClient
		.runTool(sessionId, "moveTask", {
			id: activeId,
			status: destStatus,
			position,
		})
		.catch(() => {
			toast.error("Failed to move task.");
			loadColumns(agentClient, sessionId, (s, tasks) =>
				store.setColumn(s, tasks)
			);
		});
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

export function useBoardHandlers(
	store: BoardStore,
	agentClient: AgentClient,
	sessionId: string
) {
	const ctx: HandlerCtx = { store, agentClient, sessionId };

	const onDragEnd = useCallback(
		(event: DragEndEvent) => applyDragEnd(event, store, agentClient, sessionId),
		[store, agentClient, sessionId]
	);

	const onCreate = useCallback(
		(status: BoardStatus, title: string) => applyCreate(ctx, status, title),
		[store, agentClient, sessionId] // ctx is derived from these three; safe to omit
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

	return { onDragEnd, onCreate, onDelete };
}
