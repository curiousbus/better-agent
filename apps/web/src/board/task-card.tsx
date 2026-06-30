import { Card } from "@better-agent/ui/components/card";
import { cn } from "@better-agent/ui/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TrashIcon } from "lucide-react";
import type { BoardTask } from "./board-store";

interface TaskCardProps {
	onDelete: (id: string) => void;
	onOpen: (id: string) => void;
	task: BoardTask;
}

function useCardDnd(id: string) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	return {
		attributes,
		listeners,
		setNodeRef,
		style: { transform: CSS.Transform.toString(transform), transition },
		isDragging,
	};
}

export function TaskCard({ task, onOpen, onDelete }: TaskCardProps) {
	const { attributes, listeners, setNodeRef, style, isDragging } = useCardDnd(
		task.id
	);

	return (
		<Card
			className={cn(
				"fade-in group flex animate-in items-start justify-between gap-2 p-3 text-sm duration-150",
				isDragging && "opacity-60 shadow-lg"
			)}
			ref={setNodeRef}
			style={style}
		>
			<button
				className="flex-1 cursor-grab text-left active:cursor-grabbing"
				onClick={() => onOpen(task.id)}
				type="button"
				{...attributes}
				{...listeners}
			>
				{task.title}
			</button>
			<button
				aria-label="Delete task"
				className="text-muted-foreground opacity-0 transition group-hover:opacity-100"
				onClick={(e) => {
					e.stopPropagation();
					onDelete(task.id);
				}}
				type="button"
			>
				<TrashIcon className="size-4" />
			</button>
		</Card>
	);
}
