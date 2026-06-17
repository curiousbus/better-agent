import { Button } from "@better-agent/ui/components/button";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useState } from "react";

export function Composer({
	disabled,
	streaming,
	onSend,
	onStop,
}: {
	disabled: boolean;
	streaming: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
}) {
	const [text, setText] = useState("");
	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "") {
			return;
		}
		onSend(trimmed);
		setText("");
	};
	return (
		<div className="flex items-end gap-2">
			<Textarea
				aria-label="Message"
				className="min-h-10 flex-1"
				disabled={disabled || streaming}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					}
				}}
				placeholder="Type a message… (Enter to send)"
				rows={2}
				value={text}
			/>
			{streaming ? (
				<Button onClick={onStop} size="sm" variant="destructive">
					Stop
				</Button>
			) : (
				<Button disabled={disabled} onClick={submit} size="sm">
					Send
				</Button>
			)}
		</div>
	);
}
