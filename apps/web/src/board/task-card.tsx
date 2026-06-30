import { Card } from "@better-agent/ui/components/card";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TrashIcon } from "lucide-react";
import type { BoardTask } from "./board-store";

export function TaskCard({
	task,
	onOpen,
	onDelete,
}: {
	task: BoardTask;
	onOpen: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: task.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<Card
			className={`fade-in group flex animate-in items-start justify-between gap-2 p-3 text-sm duration-150 ${isDragging ? "opacity-60 shadow-lg" : ""}`}
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
