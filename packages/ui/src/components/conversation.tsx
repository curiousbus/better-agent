import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

// Scroll container. StickToBottom keeps the viewport pinned to the bottom as
// content streams in (spring-animated), and releases the lock when the user
// scrolls up. The outer element is `relative` so the scroll button can anchor
// to it; the actual scrolling happens inside ConversationContent.
export function Conversation({
	className,
	...props
}: ComponentProps<typeof StickToBottom>) {
	return (
		<StickToBottom
			className={cn("relative flex-1 overflow-hidden", className)}
			initial="smooth"
			resize="smooth"
			role="log"
			{...props}
		/>
	);
}

export function ConversationContent({
	className,
	...props
}: ComponentProps<typeof StickToBottom.Content>) {
	return (
		<StickToBottom.Content
			className={cn("flex flex-col gap-4 p-4", className)}
			{...props}
		/>
	);
}

export function ConversationScrollButton() {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	if (isAtBottom) {
		return null;
	}
	return (
		<Button
			aria-label="Scroll to bottom"
			className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
			onClick={() => scrollToBottom()}
			size="icon-sm"
			type="button"
			variant="outline"
		>
			<ArrowDownIcon className="size-4" />
		</Button>
	);
}
