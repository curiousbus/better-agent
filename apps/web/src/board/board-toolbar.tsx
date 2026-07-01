import { Input } from "@better-agent/ui/components/input";
import { SearchIcon } from "lucide-react";
import type { BoardTask } from "./board-store";

export function matchesSearch(task: BoardTask, query: string): boolean {
	if (query === "") {
		return true;
	}
	const q = query.toLowerCase();
	return task.title.toLowerCase().includes(q) || `task-${task.seq}`.includes(q);
}

export function BoardToolbar({
	search,
	onSearch,
}: {
	onSearch: (v: string) => void;
	search: string;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 px-4 pt-3">
			<div className="relative w-full max-w-xs">
				<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="pl-8"
					onChange={(e) => onSearch(e.target.value)}
					placeholder="Search tasks…"
					value={search}
				/>
			</div>
		</div>
	);
}
