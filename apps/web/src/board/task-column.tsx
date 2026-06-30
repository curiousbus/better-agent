import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
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
	label: string;
	onCreate: (status: BoardStatus, title: string) => void;
	status: BoardStatus;
}

export function TaskColumn({
	label,
	status,
	tasks,
	loaded,
	onOpen,
	onDelete,
	onCreate,
}: TaskColumnProps) {
	const { setNodeRef } = useDroppable({ id: status });
	const [adding, setAdding] = useState(false);

	return (
		<div className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{label}</span>
				<Badge variant="secondary">{tasks.length}</Badge>
			</div>
			<div
				className="fade-in flex animate-in flex-col gap-2 overflow-y-auto"
				data-status={status}
				ref={setNodeRef}
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
