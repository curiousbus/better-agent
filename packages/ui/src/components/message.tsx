import { cn } from "@better-agent/ui/lib/utils";
import { BotIcon, UserIcon } from "lucide-react";
import type { ReactNode } from "react";

type Role = "user" | "assistant" | "system";

export function MessageAvatar({ role }: { role: Role }) {
	const isUser = role === "user";
	return (
		<div
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full border",
				isUser ? "bg-primary text-primary-foreground" : "bg-muted"
			)}
		>
			{isUser ? (
				<UserIcon className="size-4" />
			) : (
				<BotIcon className="size-4" />
			)}
		</div>
	);
}

export function MessageContent({
	children,
	from,
	className,
}: {
	children: ReactNode;
	from: Role;
	className?: string;
}) {
	const isUser = from === "user";
	return (
		<div
			className={cn(
				"max-w-[80%] rounded-lg px-3 py-2",
				isUser ? "bg-primary text-primary-foreground" : "bg-muted",
				className
			)}
		>
			{children}
		</div>
	);
}

export function Message({
	from,
	children,
	className,
}: {
	from: Role;
	children: ReactNode;
	className?: string;
}) {
	const isUser = from === "user";
	return (
		<div
			className={cn(
				"flex items-start gap-2",
				isUser ? "flex-row-reverse" : "flex-row",
				className
			)}
		>
			<MessageAvatar role={from} />
			{children}
		</div>
	);
}
