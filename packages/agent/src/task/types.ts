export type TaskStatus = "todo" | "in_progress" | "done";
export type SprintStatus = "future" | "active" | "completed";

export interface Task {
	createdAt: string;
	description: string;
	id: string;
	position: number;
	seq: number;
	sprintId: string | null;
	status: TaskStatus;
	title: string;
	updatedAt: string;
	userId: string;
}

export interface Sprint {
	createdAt: string;
	endDate: string | null;
	goal: string;
	id: string;
	name: string;
	startDate: string | null;
	status: SprintStatus;
	updatedAt: string;
	userId: string;
}
