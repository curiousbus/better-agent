import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { BoardTask } from "./board-store";
import { sortByPosition } from "./board-store";
import { InlineComposer } from "./inline-composer";
import { TaskCard } from "./task-card";

const SKELETON_ROWS = [0, 1, 2];

interface BacklogCardsProps {
	loaded: boolean;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

function BacklogCards({ tasks, loaded, onOpen, onDelete }: BacklogCardsProps) {
	if (!loaded) {
		return SKELETON_ROWS.map((row) => (
			<Skeleton className="h-12 w-full" key={row} />
		));
	}
	if (tasks.length === 0) {
		return (
			<p className="py-4 text-center text-muted-foreground text-sm">
				Backlog is empty
			</p>
		);
	}
	return sortByPosition(tasks).map((task) => (
		<TaskCard key={task.id} onDelete={onDelete} onOpen={onOpen} task={task} />
	));
}

interface BacklogFooterProps {
	adding: boolean;
	onCancel: () => void;
	onConfirm: (title: string) => void;
	onStartAdding: () => void;
}

function BacklogFooter({
	adding,
	onStartAdding,
	onConfirm,
	onCancel,
}: BacklogFooterProps) {
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
			+ Add to Backlog
		</Button>
	);
}

export interface BacklogPanelProps {
	loaded: boolean;
	onCreateBacklog: (title: string) => void;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

interface CollapsedRailProps {
	count: number;
	onExpand: () => void;
}

function CollapsedRail({ count, onExpand }: CollapsedRailProps) {
	return (
		<div className="flex flex-col items-center border-l bg-muted/20 px-2 py-3">
			<Button
				aria-label="Expand backlog"
				onClick={onExpand}
				size="icon"
				type="button"
				variant="ghost"
			>
				<ChevronLeftIcon className="size-4" />
			</Button>
			<span className="mt-2 rotate-90 whitespace-nowrap text-muted-foreground text-xs">
				Backlog ({count})
			</span>
		</div>
	);
}

interface DroppableListProps {
	loaded: boolean;
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	tasks: BoardTask[];
}

function DroppableList({
	tasks,
	loaded,
	onOpen,
	onDelete,
}: DroppableListProps) {
	const { setNodeRef } = useDroppable({ id: "backlog" });
	return (
		<div
			className="flex flex-1 flex-col gap-2 overflow-y-auto"
			ref={setNodeRef}
		>
			<SortableContext
				items={sortByPosition(tasks).map((t) => t.id)}
				strategy={verticalListSortingStrategy}
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

interface ExpandedPanelProps extends BacklogPanelProps {
	onCollapse: () => void;
}

function ExpandedPanel({
	tasks,
	loaded,
	onOpen,
	onDelete,
	onCreateBacklog,
	onCollapse,
}: ExpandedPanelProps) {
	const [adding, setAdding] = useState(false);
	return (
		<div className="flex w-72 shrink-0 flex-col gap-3 border-l bg-muted/20 p-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">Backlog</span>
					<Badge variant="secondary">{tasks.length}</Badge>
				</div>
				<Button
					aria-label="Collapse backlog"
					onClick={onCollapse}
					size="icon"
					type="button"
					variant="ghost"
				>
					<ChevronRightIcon className="size-4" />
				</Button>
			</div>
			<DroppableList
				loaded={loaded}
				onDelete={onDelete}
				onOpen={onOpen}
				tasks={tasks}
			/>
			<BacklogFooter
				adding={adding}
				onCancel={() => setAdding(false)}
				onConfirm={(title) => {
					onCreateBacklog(title);
					setAdding(false);
				}}
				onStartAdding={() => setAdding(true)}
			/>
		</div>
	);
}

export function BacklogPanel(props: BacklogPanelProps) {
	const [collapsed, setCollapsed] = useState(false);
	if (collapsed) {
		return (
			<CollapsedRail
				count={props.tasks.length}
				onExpand={() => setCollapsed(false)}
			/>
		);
	}
	return <ExpandedPanel {...props} onCollapse={() => setCollapsed(true)} />;
}
