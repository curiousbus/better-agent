export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
	createdAt: string;
	description: string;
	id: string;
	position: number;
	status: TaskStatus;
	title: string;
	updatedAt: string;
	userId: string;
}
