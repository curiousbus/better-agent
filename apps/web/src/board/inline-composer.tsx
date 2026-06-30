import { Input } from "@better-agent/ui/components/input";
import { type KeyboardEvent, useRef, useState } from "react";

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
	// Enter already commits; suppress the blur that immediately follows so a
	// single Enter can't fire two createTask calls (the race the final review
	// flagged). A standalone blur (clicking away) still commits/cancels.
	const handledByEnter = useRef(false);

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
			handledByEnter.current = true;
			commit();
		} else if (e.key === "Escape") {
			onCancel();
		}
	};

	const handleBlur = () => {
		if (handledByEnter.current) {
			handledByEnter.current = false;
			return;
		}
		commit();
	};

	return (
		<Input
			autoFocus
			onBlur={handleBlur}
			onChange={(e) => setValue(e.target.value)}
			onKeyDown={handleKeyDown}
			placeholder={placeholder}
			value={value}
		/>
	);
}
