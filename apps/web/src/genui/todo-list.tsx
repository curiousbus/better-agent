import { Button } from "@better-agent/ui/components/button";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Input } from "@better-agent/ui/components/input";
import { Trash2Icon } from "lucide-react";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import {
	addTodo,
	getTodos,
	removeTodo,
	subscribe,
	type Todo,
	toggleTodo,
} from "./todo-store";

function TodoItem({ todo }: { todo: Todo }) {
	return (
		<li className="fade-in slide-in-from-top-1 flex animate-in items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-muted/50">
			<Checkbox
				checked={todo.done}
				onCheckedChange={() => toggleTodo(todo.id)}
			/>
			<span
				className={
					todo.done
						? "flex-1 text-muted-foreground text-sm line-through"
						: "flex-1 text-sm"
				}
			>
				{todo.title}
			</span>
			<Button
				aria-label={`Delete ${todo.title}`}
				className="size-7 text-muted-foreground hover:text-destructive"
				onClick={() => removeTodo(todo.id)}
				size="icon"
				variant="ghost"
			>
				<Trash2Icon className="size-4" />
			</Button>
		</li>
	);
}

function TodoAdder() {
	const [title, setTitle] = useState("");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (title.trim() !== "") {
			addTodo(title);
			setTitle("");
		}
	};
	return (
		<form className="flex gap-2" onSubmit={submit}>
			<Input
				onChange={(event) => setTitle(event.target.value)}
				placeholder="Add a task…"
				value={title}
			/>
			<Button disabled={title.trim() === ""} type="submit">
				Add
			</Button>
		</form>
	);
}

/** A real, self-contained interactive todo list. Add / toggle / delete happen
 * locally and instantly (localStorage); the agent's tools write the same store
 * so conversational edits stay in sync. */
export function TodoList() {
	const todos = useSyncExternalStore(subscribe, getTodos, getTodos);
	const remaining = todos.filter((t) => !t.done).length;
	return (
		<div className="fade-in slide-in-from-bottom-2 flex w-full max-w-md animate-in flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm duration-300">
			<div className="flex items-center justify-between">
				<h3 className="font-medium text-sm">Todo</h3>
				<span className="text-muted-foreground text-xs">{remaining} left</span>
			</div>
			<TodoAdder />
			{todos.length === 0 ? (
				<p className="py-6 text-center text-muted-foreground text-sm">
					No tasks yet — add one above, or ask the agent.
				</p>
			) : (
				<ul className="flex flex-col gap-0.5">
					{todos.map((todo) => (
						<TodoItem key={todo.id} todo={todo} />
					))}
				</ul>
			)}
		</div>
	);
}
