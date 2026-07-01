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
				<p className="line-clamp-2 text-muted-foreground text-xs">
					{task.description}
				</p>
			) : null}
			<TaskCardFooter createdAt={task.createdAt} initial={initial} />
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
	const style = { transform: CSS.Transform.toString(transform), transition };

	return (
		<Card
			className={cn(
				"flex cursor-grab flex-col gap-2 p-3",
				// While dragging, the original leaves a dim placeholder; the moving
				// card is rendered by the DragOverlay so it follows the cursor smoothly.
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

// Rendered inside <DragOverlay> — a lifted clone that follows the cursor.
export function TaskCardOverlay({ task }: { task: BoardTask }) {
	return (
		<Card className="flex rotate-2 cursor-grabbing flex-col gap-2 p-3 shadow-2xl">
			<CardBody onDelete={noop} onOpen={noop} task={task} />
		</Card>
	);
}
