import { Avatar, AvatarFallback } from "@better-agent/ui/components/avatar";
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { cn } from "@better-agent/ui/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontalIcon } from "lucide-react";
import type { BoardTask } from "./board-store";
import { relativeTime } from "./relative-time";
import { useCurrentUser } from "./use-current-user";

interface TaskCardProps {
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	task: BoardTask;
}

interface CardMenuProps {
	onDelete: () => void;
	onOpen: () => void;
}

function CardMenu({ onOpen, onDelete }: CardMenuProps) {
	const stop = (e: React.PointerEvent | React.MouseEvent) =>
		e.stopPropagation();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="Task options"
						className="shrink-0"
						onClick={stop}
						onPointerDown={stop}
						size="icon"
						type="button"
						variant="ghost"
					/>
				}
			>
				<MoreHorizontalIcon className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
				<DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function TaskCardFooter({
	initial,
	createdAt,
}: {
	createdAt: string | undefined;
	initial: string;
}) {
	return (
		<div className="flex items-center justify-between pt-1">
			<Avatar size="sm">
				<AvatarFallback>{initial}</AvatarFallback>
			</Avatar>
			{createdAt ? (
				<span className="text-muted-foreground text-xs">
					{relativeTime(createdAt)}
				</span>
			) : null}
		</div>
	);
}

// Presentational card content, shared by the sortable card and the drag overlay.
function CardBody({ task, onOpen, onDelete }: TaskCardProps) {
	const { initial } = useCurrentUser();
	return (
		<>
			<div className="flex items-center justify-between">
				<span className="font-mono text-muted-foreground text-xs">
					TASK-{task.seq}
				</span>
				<CardMenu
					onDelete={() => onDelete(task.id)}
					onOpen={() => onOpen(task.id)}
				/>
			</div>
			<p className="line-clamp-2 font-medium text-sm">{task.title}</p>
			{task.description ? (
				<p className="line-clamp-1 text-foreground/70 text-sm">
					{task.description}
				</p>
			) : null}
			<div className="mt-auto">
				<TaskCardFooter createdAt={task.createdAt} initial={initial} />
			</div>
		</>
	);
}

export function TaskCard({ task, onOpen, onDelete }: TaskCardProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: task.id });
	// The active card stays put as a dim placeholder (the DragOverlay follows the
	// cursor); only siblings translate to make room.
	const style = {
		transform: isDragging ? undefined : CSS.Transform.toString(transform),
		transition,
	};

	return (
		<Card
			className={cn(
				// No border/ring/outline at rest — only the DragOverlay shows a ring
				// while dragging. (Card base has ring-1 + dnd-kit adds a focusable
				// role=button whose square outline showed as corner slivers.)
				// Fixed height so the Nth card aligns across all three columns.
				"flex h-32 shrink-0 cursor-grab flex-col gap-1.5 p-3 shadow-sm outline-none ring-0",
				isDragging && "opacity-40"
			)}
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
		>
			<CardBody onDelete={onDelete} onOpen={onOpen} task={task} />
		</Card>
	);
}

const noop = () => undefined;

// Rendered inside <DragOverlay> — a lifted clone that follows the cursor. w-full
// makes it match the source card's measured width (the overlay wrapper is sized
// to the dragged node).
export function TaskCardOverlay({ task }: { task: BoardTask }) {
	return (
		<Card className="flex h-32 w-full cursor-grabbing flex-col gap-1.5 p-3 shadow-xl ring-2 ring-primary">
			<CardBody onDelete={noop} onOpen={noop} task={task} />
		</Card>
	);
}
