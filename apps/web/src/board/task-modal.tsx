"use client";

import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Label } from "@better-agent/ui/components/label";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { Textarea } from "@better-agent/ui/components/textarea";
import type { AgentClient } from "@curiousbus/agent-client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { parseTask } from "./board-client";
import type { BoardTask } from "./board-store";

interface TaskDetail {
	loading: boolean;
	task: BoardTask | null;
}

function useTaskDetail(
	agentClient: AgentClient,
	sessionId: string,
	taskId: string | null
): TaskDetail {
	const [task, setTask] = useState<BoardTask | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!taskId) {
			setTask(null);
			return () => undefined;
		}
		let active = true;
		setLoading(true);
		agentClient
			.runTool(sessionId, "getTask", { id: taskId })
			.then((result) => {
				if (!active) {
					return;
				}
				setTask(parseTask(result));
			})
			.catch(() => {
				if (!active) {
					return;
				}
				toast.error("Failed to load task details.");
			})
			.finally(() => {
				if (active) {
					setLoading(false);
				}
			});
		return () => {
			active = false;
		};
	}, [agentClient, sessionId, taskId]);

	return { task, loading };
}

export interface TaskModalProps {
	agentClient: AgentClient;
	onClose: () => void;
	onSaved: () => void;
	sessionId: string;
	taskId: string | null;
}

function TaskModalSkeleton() {
	return (
		<>
			<DialogHeader>
				<Skeleton className="h-4 w-3/4" />
			</DialogHeader>
			<div className="flex flex-col gap-2 py-2">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="min-h-32 w-full rounded-md" />
			</div>
			<DialogFooter>
				<Skeleton className="h-7 w-16" />
			</DialogFooter>
		</>
	);
}

interface TaskModalFormProps {
	agentClient: AgentClient;
	onClose: () => void;
	onSaved: () => void;
	sessionId: string;
	task: BoardTask;
}

async function saveTask(
	agentClient: AgentClient,
	sessionId: string,
	taskId: string,
	description: string
): Promise<void> {
	await agentClient.runTool(sessionId, "updateTask", {
		id: taskId,
		description,
	});
}

function TaskModalForm({
	agentClient,
	onClose,
	onSaved,
	sessionId,
	task,
}: TaskModalFormProps) {
	const [description, setDescription] = useState(task.description);
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		setSaving(true);
		try {
			await saveTask(agentClient, sessionId, task.id, description);
			onSaved();
			onClose();
		} catch {
			toast.error("Failed to save task. Please try again.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>{task.title}</DialogTitle>
			</DialogHeader>
			<div className="flex flex-col gap-2 py-2">
				<Label htmlFor="task-description">Description</Label>
				<Textarea
					className="min-h-32"
					disabled={saving}
					id="task-description"
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Add a description…"
					value={description}
				/>
			</div>
			<DialogFooter showCloseButton>
				<Button disabled={saving} onClick={handleSave}>
					{saving ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</>
	);
}

function TaskModalBody({
	agentClient,
	sessionId,
	taskId,
	onClose,
	onSaved,
}: TaskModalProps) {
	const { task, loading } = useTaskDetail(agentClient, sessionId, taskId);

	if (loading || !task) {
		return <TaskModalSkeleton />;
	}

	return (
		<TaskModalForm
			agentClient={agentClient}
			onClose={onClose}
			onSaved={onSaved}
			sessionId={sessionId}
			task={task}
		/>
	);
}

export function TaskModal({
	agentClient,
	onClose,
	onSaved,
	sessionId,
	taskId,
}: TaskModalProps) {
	return (
		<Dialog
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					onClose();
				}
			}}
			open={taskId !== null}
		>
			<DialogContent className="sm:max-w-md">
				<TaskModalBody
					agentClient={agentClient}
					onClose={onClose}
					onSaved={onSaved}
					sessionId={sessionId}
					taskId={taskId}
				/>
			</DialogContent>
		</Dialog>
	);
}
