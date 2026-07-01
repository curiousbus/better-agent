import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useState } from "react";
import type { BoardSprint } from "./use-sprints";

interface SprintBarProps {
	active: BoardSprint | null;
	loading: boolean;
	onComplete: (id: string) => Promise<void>;
	onCreate: (name: string, goal?: string) => Promise<void>;
	onStart: (id: string) => Promise<void>;
	sprints: BoardSprint[];
}

interface CreateSprintDialogProps {
	onCreate: (name: string, goal?: string) => Promise<void>;
}

function CreateSprintDialog({ onCreate }: CreateSprintDialogProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [goal, setGoal] = useState("");

	const handleCreate = async () => {
		if (!name.trim()) {
			return;
		}
		await onCreate(name.trim(), goal.trim() || undefined);
		setName("");
		setGoal("");
		setOpen(false);
	};

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button size="sm" variant="outline" />}>
				New sprint
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create sprint</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 pt-2">
					<Input
						onChange={(e) => setName(e.target.value)}
						placeholder="Sprint name"
						value={name}
					/>
					<Input
						onChange={(e) => setGoal(e.target.value)}
						placeholder="Goal (optional)"
						value={goal}
					/>
					<Button disabled={!name.trim()} onClick={handleCreate}>
						Create
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

interface ActiveSprintBarProps {
	onComplete: (id: string) => Promise<void>;
	sprint: BoardSprint;
}

function ActiveSprintBar({ sprint, onComplete }: ActiveSprintBarProps) {
	const dateRange =
		sprint.startDate && sprint.endDate
			? `${sprint.startDate} – ${sprint.endDate}`
			: null;

	return (
		<div className="flex items-center gap-3">
			<span className="font-medium">{sprint.name}</span>
			{dateRange && (
				<span className="text-muted-foreground text-sm">{dateRange}</span>
			)}
			<Badge variant="secondary">Active</Badge>
			<Button onClick={() => onComplete(sprint.id)} size="sm" variant="outline">
				Complete sprint
			</Button>
		</div>
	);
}

interface NoSprintBarProps {
	onCreate: (name: string, goal?: string) => Promise<void>;
	onStart: (id: string) => Promise<void>;
	sprints: BoardSprint[];
}

function NoSprintBar({ sprints, onCreate, onStart }: NoSprintBarProps) {
	const [selectedId, setSelectedId] = useState("");
	const future = sprints.filter(
		(s) => s.status !== "active" && s.status !== "completed"
	);
	const items = Object.fromEntries(future.map((s) => [s.id, s.name]));

	return (
		<div className="flex items-center gap-3">
			<span className="text-muted-foreground text-sm">No active sprint</span>
			<CreateSprintDialog onCreate={onCreate} />
			{future.length > 0 && (
				<>
					<Select
						items={items}
						onValueChange={(v) => setSelectedId(v ?? "")}
						value={selectedId}
					>
						<SelectTrigger className="w-40">
							<SelectValue placeholder="Pick sprint" />
						</SelectTrigger>
						<SelectContent>
							{future.map((s) => (
								<SelectItem key={s.id} value={s.id}>
									{s.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						disabled={!selectedId}
						onClick={() => onStart(selectedId)}
						size="sm"
					>
						Start
					</Button>
				</>
			)}
		</div>
	);
}

export function SprintBar({
	active,
	sprints,
	loading,
	onComplete,
	onCreate,
	onStart,
}: SprintBarProps) {
	if (loading) {
		return (
			<div className="flex items-center gap-3 border-b px-4 py-2">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-5 w-16" />
			</div>
		);
	}

	return (
		<div className="flex items-center justify-between border-b px-4 py-2">
			{active ? (
				<ActiveSprintBar onComplete={onComplete} sprint={active} />
			) : (
				<NoSprintBar onCreate={onCreate} onStart={onStart} sprints={sprints} />
			)}
		</div>
	);
}
