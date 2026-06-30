import { Badge } from "@better-agent/ui/components/badge";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { BoardStatus, BoardTask } from "./board-store";
import { TaskCard } from "./task-card";

const SKELETON_ROWS = [0, 1];

export function TaskColumn({
	label,
	status,
	tasks,
	loaded,
	onOpen,
	onDelete,
}: {
	label: string;
	status: BoardStatus;
	tasks: BoardTask[];
	loaded: boolean;
	onOpen: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<div className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">{label}</span>
				<Badge variant="secondary">{tasks.length}</Badge>
			</div>
			<div
				className="fade-in flex animate-in flex-col gap-2 overflow-y-auto"
				data-status={status}
			>
				{loaded
					? tasks.map((task) => (
							<TaskCard
								key={task.id}
								onDelete={onDelete}
								onOpen={onOpen}
								task={task}
							/>
						))
					: SKELETON_ROWS.map((row) => (
							<Skeleton className="h-12 w-full" key={row} />
						))}
			</div>
		</div>
	);
}
