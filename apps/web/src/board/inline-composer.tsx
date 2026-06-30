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

	const commit = () => {
		const trimmed = value.trim();
		if (trimmed) {
			onConfirm(trimmed);
			setValue("");
		} else {
			onCancel();
		}
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			commit();
		} else if (e.key === "Escape") {
			onCancel();
		}
	};

	return (
		<Input
			autoFocus
			onBlur={commit}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={handleKeyDown}
			placeholder={placeholder}
			value={value}
		/>
	);
}
