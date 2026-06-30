import { Card } from "@better-agent/ui/components/card";
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
	return (
		<Card className="fade-in group flex animate-in items-start justify-between gap-2 p-3 text-sm duration-150">
			<button
				className="flex-1 text-left"
				onClick={() => onOpen(task.id)}
				type="button"
			>
				{task.title}
			</button>
			<button
				aria-label="Delete task"
				className="text-muted-foreground opacity-0 transition group-hover:opacity-100"
				onClick={() => onDelete(task.id)}
				type="button"
			>
				<TrashIcon className="size-4" />
			</button>
		</Card>
	);
}
