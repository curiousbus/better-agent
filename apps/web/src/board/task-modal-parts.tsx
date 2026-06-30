"use client";

import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { Textarea } from "@better-agent/ui/components/textarea";
import type { AgentClient } from "@curiousbus/agent-client";
import { useState } from "react";
import { toast } from "sonner";
import type { BoardStatus, BoardTask } from "./board-store";
import { COLUMNS } from "./board-store";
import type { BoardSprint } from "./use-sprints";

export interface MoveCtx {
	agentClient: AgentClient;
	onSaved: () => void;
	sessionId: string;
	task: BoardTask;
}

async function applyStatus(ctx: MoveCtx, value: string | null): Promise<void> {
	if (!value) {
		return;
	}
	try {
		await ctx.agentClient.runTool(ctx.sessionId, "moveTask", {
			id: ctx.task.id,
			status: value as BoardStatus,
			position: ctx.task.position,
		});
		ctx.onSaved();
	} catch {
		toast.error("Failed to update status.");
	}
}

async function applySprint(ctx: MoveCtx, value: string | null): Promise<void> {
	try {
		await ctx.agentClient.runTool(ctx.sessionId, "moveTask", {
			id: ctx.task.id,
			sprintId: value === "" || value === null ? null : value,
			status: ctx.task.status,
			position: ctx.task.position,
		});
		ctx.onSaved();
	} catch {
		toast.error("Failed to update sprint.");
	}
}

function StatusSelect({ ctx, status }: { ctx: MoveCtx; status: BoardStatus }) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="task-status">Status</Label>
			<Select onValueChange={(v) => applyStatus(ctx, v)} value={status}>
				<SelectTrigger className="w-full" id="task-status">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{COLUMNS.map((col) => (
						<SelectItem key={col.status} value={col.status}>
							{col.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function SprintSelect({
	ctx,
	sprintId,
	sprints,
}: {
	ctx: MoveCtx;
	sprintId: string | null;
	sprints: BoardSprint[];
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="task-sprint">Sprint</Label>
			<Select onValueChange={(v) => applySprint(ctx, v)} value={sprintId ?? ""}>
				<SelectTrigger className="w-full" id="task-sprint">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="">Backlog</SelectItem>
					{sprints.map((s) => (
						<SelectItem key={s.id} value={s.id}>
							{s.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

export interface TaskModalControlsProps {
	agentClient: AgentClient;
	onSaved: () => void;
	sessionId: string;
	sprints: BoardSprint[];
	task: BoardTask;
}

export function TaskModalControls({
	agentClient,
	onSaved,
	sessionId,
	sprints,
	task,
}: TaskModalControlsProps) {
	const ctx: MoveCtx = { agentClient, onSaved, sessionId, task };
	return (
		<div className="grid grid-cols-2 gap-3">
			<StatusSelect ctx={ctx} status={task.status} />
			<SprintSelect ctx={ctx} sprintId={task.sprintId} sprints={sprints} />
		</div>
	);
}

export interface TaskModalFieldsProps {
	description: string;
	disabled: boolean;
	onDescriptionChange: (v: string) => void;
	onTitleChange: (v: string) => void;
	title: string;
}

export function TaskModalFields({
	description,
	disabled,
	onDescriptionChange,
	onTitleChange,
	title,
}: TaskModalFieldsProps) {
	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="task-title">Title</Label>
				<Input
					disabled={disabled}
					id="task-title"
					onChange={(e) => onTitleChange(e.target.value)}
					value={title}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="task-description">Description</Label>
				<Textarea
					className="min-h-24"
					disabled={disabled}
					id="task-description"
					onChange={(e) => onDescriptionChange(e.target.value)}
					placeholder="Add a description…"
					value={description}
				/>
			</div>
		</>
	);
}

export interface UseSaveTaskArgs {
	agentClient: AgentClient;
	onClose: () => void;
	onSaved: () => void;
	sessionId: string;
	task: BoardTask;
}

export function useSaveTask(args: UseSaveTaskArgs) {
	const [title, setTitle] = useState(args.task.title);
	const [description, setDescription] = useState(args.task.description);
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		setSaving(true);
		try {
			await args.agentClient.runTool(args.sessionId, "updateTask", {
				id: args.task.id,
				title,
				description,
			});
			args.onSaved();
			args.onClose();
		} catch {
			toast.error("Failed to save task. Please try again.");
		} finally {
			setSaving(false);
		}
	};

	return { title, setTitle, description, setDescription, saving, handleSave };
}
