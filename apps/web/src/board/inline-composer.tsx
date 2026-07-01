import { Input } from "@better-agent/ui/components/input";
import { type KeyboardEvent, useState } from "react";

interface InlineComposerProps {
	onCancel: () => void;
	onConfirm: (title: string) => void;
	placeholder?: string;
}

export function InlineComposer({
	onConfirm,
	onCancel,
	placeholder = "Task title…",
}: InlineComposerProps) {
	const [value, setValue] = useState("");

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const trimmed = value.trim();
			// Only a non-empty title creates a task; an empty Enter does nothing
			// (never creates a blank card). Stays open for rapid entry.
			if (trimmed) {
				onConfirm(trimmed);
				setValue("");
			}
		} else if (e.key === "Escape") {
			onCancel();
		}
	};

	return (
		<Input
			autoFocus
			// Blur just closes the composer — it never creates (no accidental blank
			// tasks from focus loss on re-render).
			onBlur={onCancel}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={handleKeyDown}
			placeholder={placeholder}
			value={value}
		/>
	);
}
