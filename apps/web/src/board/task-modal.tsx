"use client";

import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import type { AgentClient } from "@curiousbus/agent-client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { parseTask } from "./board-client";
import type { BoardTask } from "./board-store";
import {
	TaskModalControls,
	TaskModalFields,
	useSaveTask,
} from "./task-modal-parts";
import type { BoardSprint } from "./use-sprints";

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
	activeSprintId: string | null;
	agentClient: AgentClient;
	onClose: () => void;
	onSaved: () => void;
	sessionId: string;
	sprints: BoardSprint[];
	taskId: string | null;
}

function TaskModalSkeleton() {
	return (
		<>
			<DialogHeader>
				<Skeleton className="h-4 w-3/4" />
			</DialogHeader>
			<div className="flex flex-col gap-3 py-2">
				<Skeleton className="h-3 w-16" />
				<Skeleton className="h-8 w-full rounded-md" />
				<Skeleton className="h-3 w-16" />
				<Skeleton className="min-h-24 w-full rounded-md" />
				<div className="grid grid-cols-2 gap-3">
					<Skeleton className="h-8 w-full rounded-md" />
					<Skeleton className="h-8 w-full rounded-md" />
				</div>
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
	sprints: BoardSprint[];
	task: BoardTask;
}

function TaskModalForm({
	agentClient,
	onClose,
	onSaved,
	sessionId,
	sprints,
	task,
}: TaskModalFormProps) {
	const { title, setTitle, description, setDescription, saving, handleSave } =
		useSaveTask({ agentClient, onClose, onSaved, sessionId, task });

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					TASK-{task.seq}
					<span className="ml-2 font-normal text-muted-foreground text-xs">
						{task.title}
					</span>
				</DialogTitle>
			</DialogHeader>
			<div className="flex flex-col gap-3 py-2">
				<TaskModalFields
					description={description}
					disabled={saving}
					onDescriptionChange={setDescription}
					onTitleChange={setTitle}
					title={title}
				/>
				<TaskModalControls
					agentClient={agentClient}
					onSaved={onSaved}
					sessionId={sessionId}
					sprints={sprints}
					task={task}
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

interface TaskModalBodyProps {
	activeSprintId: string | null;
	agentClient: AgentClient;
	onClose: () => void;
	onSaved: () => void;
	sessionId: string;
	sprints: BoardSprint[];
	taskId: string | null;
}

function TaskModalBody({
	activeSprintId: _activeSprintId,
	agentClient,
	sessionId,
	taskId,
	onClose,
	onSaved,
	sprints,
}: TaskModalBodyProps) {
	const { task, loading } = useTaskDetail(agentClient, sessionId, taskId);

	if (!taskId) {
		return null;
	}
	if (loading || !task) {
		return <TaskModalSkeleton />;
	}

	return (
		<TaskModalForm
			agentClient={agentClient}
			onClose={onClose}
			onSaved={onSaved}
			sessionId={sessionId}
			sprints={sprints}
			task={task}
		/>
	);
}

export function TaskModal({
	activeSprintId,
	agentClient,
	onClose,
	onSaved,
	sessionId,
	sprints,
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
					activeSprintId={activeSprintId}
					agentClient={agentClient}
					onClose={onClose}
					onSaved={onSaved}
					sessionId={sessionId}
					sprints={sprints}
					taskId={taskId}
				/>
			</DialogContent>
		</Dialog>
	);
}
