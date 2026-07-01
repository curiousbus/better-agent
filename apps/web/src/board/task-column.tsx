import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";
import type { BoardStatus, BoardTask } from "./board-store";
import { InlineComposer } from "./inline-composer";
import { TaskCard } from "./task-card";

const SKELETON_ROWS = [0, 1];

function EmptyColumn() {
	return (
		<p className="py-2 text-center text-muted-foreground text-sm">
			No tasks yet
		</p>
	);
}

interface CardListProps {
	loaded: boolean;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

function ColumnCards({ tasks, loaded, onOpen, onDelete }: CardListProps) {
	if (!loaded) {
		return SKELETON_ROWS.map((row) => (
			<Skeleton className="h-12 w-full" key={row} />
		));
	}
	if (tasks.length === 0) {
		return <EmptyColumn />;
	}
	return tasks.map((task) => (
		<TaskCard key={task.id} onDelete={onDelete} onOpen={onOpen} task={task} />
	));
}

interface ColumnFooterProps {
	adding: boolean;
	onCancel: () => void;
	onConfirm: (title: string) => void;
	onStartAdding: () => void;
}

function ColumnFooter({
	adding,
	onStartAdding,
	onConfirm,
	onCancel,
}: ColumnFooterProps) {
	if (adding) {
		return <InlineComposer onCancel={onCancel} onConfirm={onConfirm} />;
	}
	return (
		<Button
			className="w-full justify-start text-muted-foreground"
			onClick={onStartAdding}
			size="sm"
			type="button"
			variant="ghost"
		>
			+ Add
		</Button>
	);
}

interface TaskColumnProps extends CardListProps {
	dragging: boolean;
	label: string;
	onCreate: (status: BoardStatus, title: string) => void;
	status: BoardStatus;
}

// While dragging, spotlight the column under the cursor and fade the rest — the
// standard "where will it land" cue.
function columnClass(dragging: boolean, isOver: boolean) {
	return cn(
		"flex min-h-0 min-w-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3 transition",
		dragging && !isOver && "opacity-40",
		dragging && isOver && "bg-primary/5 ring-2 ring-primary"
	);
}

export function TaskColumn({
	dragging,
	label,
	status,
	tasks,
	loaded,
	onOpen,
	onDelete,
	onCreate,
}: TaskColumnProps) {
	const { setNodeRef, isOver } = useDroppable({ id: status });
	const [adding, setAdding] = useState(false);

	return (
		<div className={columnClass(dragging, isOver)} ref={setNodeRef}>
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{label}</span>
				<Badge variant="secondary">{tasks.length}</Badge>
			</div>
			<div
				className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
				data-status={status}
			>
				<SortableContext
					items={tasks.map((t) => t.id)}
					strategy={verticalListSortingStrategy}
				>
					<ColumnCards
						loaded={loaded}
						onDelete={onDelete}
						onOpen={onOpen}
						tasks={tasks}
					/>
				</SortableContext>
			</div>
			<ColumnFooter
				adding={adding}
				onCancel={() => setAdding(false)}
				onConfirm={(title) => {
					onCreate(status, title);
				}}
				onStartAdding={() => setAdding(true)}
			/>
		</div>
	);
}
