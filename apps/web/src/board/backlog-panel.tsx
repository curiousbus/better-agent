import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useDroppable } from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import { type BoardTask, sortByPosition } from "./board-store";
import { InlineComposer } from "./inline-composer";
import { TaskCard } from "./task-card";

const SKELETON_ROWS = [0, 1];

interface BacklogCardsProps {
	loaded: boolean;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

function BacklogCards({ tasks, loaded, onOpen, onDelete }: BacklogCardsProps) {
	if (!loaded) {
		return SKELETON_ROWS.map((row) => (
			<Skeleton className="h-24 w-64 shrink-0" key={row} />
		));
	}
	if (tasks.length === 0) {
		return (
			<p className="px-2 py-6 text-muted-foreground text-sm">
				Backlog is empty
			</p>
		);
	}
	return sortByPosition(tasks).map((task) => (
		<div className="w-64 shrink-0" key={task.id}>
			<TaskCard onDelete={onDelete} onOpen={onOpen} task={task} />
		</div>
	));
}

function DroppableRow({ tasks, loaded, onOpen, onDelete }: BacklogCardsProps) {
	const { setNodeRef } = useDroppable({ id: "backlog" });
	return (
		<div
			className="flex flex-1 items-start gap-2 overflow-x-auto pb-1"
			ref={setNodeRef}
		>
			<SortableContext
				items={sortByPosition(tasks).map((t) => t.id)}
				strategy={horizontalListSortingStrategy}
			>
				<BacklogCards
					loaded={loaded}
					onDelete={onDelete}
					onOpen={onOpen}
					tasks={tasks}
				/>
			</SortableContext>
		</div>
	);
}

export interface BacklogPanelProps {
	loaded: boolean;
	onCreateBacklog: (title: string) => void;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

function BacklogAdd({
	adding,
	setAdding,
	onCreateBacklog,
}: {
	adding: boolean;
	onCreateBacklog: (title: string) => void;
	setAdding: (v: boolean) => void;
}) {
	if (adding) {
		return (
			<div className="w-64">
				<InlineComposer
					onCancel={() => setAdding(false)}
					onConfirm={(title) => {
						onCreateBacklog(title);
						setAdding(false);
					}}
				/>
			</div>
		);
	}
	return (
		<Button
			onClick={() => setAdding(true)}
			size="sm"
			type="button"
			variant="ghost"
		>
			+ Add
		</Button>
	);
}

function BacklogHeader({
	count,
	adding,
	onCreateBacklog,
	setAdding,
	onCollapse,
}: {
	adding: boolean;
	count: number;
	onCollapse: () => void;
	onCreateBacklog: (title: string) => void;
	setAdding: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<div className="flex items-center gap-2">
				<span className="font-medium text-sm">Backlog</span>
				<Badge variant="secondary">{count}</Badge>
			</div>
			<div className="flex flex-1 items-center justify-end gap-2">
				<BacklogAdd
					adding={adding}
					onCreateBacklog={onCreateBacklog}
					setAdding={setAdding}
				/>
				<Button
					aria-label="Collapse backlog"
					onClick={onCollapse}
					size="icon"
					type="button"
					variant="ghost"
				>
					<ChevronDownIcon className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function ExpandedPanel({
	tasks,
	loaded,
	onOpen,
	onDelete,
	onCreateBacklog,
	onCollapse,
}: BacklogPanelProps & { onCollapse: () => void }) {
	const [adding, setAdding] = useState(false);
	return (
		<div className="flex max-h-64 shrink-0 flex-col gap-2 border-t bg-muted/20 p-3">
			<BacklogHeader
				adding={adding}
				count={tasks.length}
				onCollapse={onCollapse}
				onCreateBacklog={onCreateBacklog}
				setAdding={setAdding}
			/>
			<DroppableRow
				loaded={loaded}
				onDelete={onDelete}
				onOpen={onOpen}
				tasks={tasks}
			/>
		</div>
	);
}

export function BacklogPanel(props: BacklogPanelProps) {
	const [collapsed, setCollapsed] = useState(false);
	if (collapsed) {
		return (
			<button
				className="flex shrink-0 items-center gap-2 border-t bg-muted/20 px-3 py-2 text-muted-foreground text-sm"
				onClick={() => setCollapsed(false)}
				type="button"
			>
				<ChevronUpIcon className="size-4" />
				Backlog ({props.tasks.length})
			</button>
		);
	}
	return <ExpandedPanel {...props} onCollapse={() => setCollapsed(true)} />;
}
