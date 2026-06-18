import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useRef } from "react";

const MAX_TEXTAREA_PX = 200;

export function PromptInput({
	onSubmit,
	children,
	className,
}: {
	onSubmit: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<form
			className={cn("rounded-lg border bg-background p-2", className)}
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{children}
		</form>
	);
}

export function PromptInputTextarea({
	value,
	onChange,
	onSubmit,
	disabled,
	placeholder = "Type a message… (Enter to send)",
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);
	const resize = () => {
		const el = ref.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
		}
	};
	return (
		<textarea
			aria-label="Message"
			className="w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
			disabled={disabled}
			onChange={(event) => {
				onChange(event.target.value);
				resize();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSubmit();
				}
			}}
			placeholder={placeholder}
			ref={ref}
			rows={1}
			style={{ maxHeight: MAX_TEXTAREA_PX }}
			value={value}
		/>
	);
}

export function PromptInputToolbar({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center justify-between pt-1">{children}</div>
	);
}

export function PromptInputTools({ children }: { children?: ReactNode }) {
	return <div className="flex items-center gap-1">{children}</div>;
}

export function PromptInputSubmit({
	status,
	onStop,
}: {
	status: "idle" | "streaming";
	onStop: () => void;
}) {
	if (status === "streaming") {
		return (
			<Button
				aria-label="Stop"
				onClick={onStop}
				size="icon-sm"
				type="button"
				variant="destructive"
			>
				<SquareIcon className="size-3.5" />
			</Button>
		);
	}
	return (
		<Button aria-label="Send" size="icon-sm" type="submit">
			<ArrowUpIcon className="size-4" />
		</Button>
	);
}
