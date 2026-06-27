"use client";

import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

function MessageScrollerProvider(
	props: ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
	return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
	return (
		<MessageScrollerPrimitive.Root
			className={cn(
				"group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
				className
			)}
			data-slot="message-scroller"
			{...props}
		/>
	);
}

function MessageScrollerViewport({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
	return (
		<MessageScrollerPrimitive.Viewport
			className={cn(
				"scroll-fade-b size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain",
				className
			)}
			data-slot="message-scroller-viewport"
			{...props}
		/>
	);
}

function MessageScrollerContent({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
	return (
		<MessageScrollerPrimitive.Content
			className={cn("flex h-max min-h-full flex-col gap-6", className)}
			data-slot="message-scroller-content"
			{...props}
		/>
	);
}

function MessageScrollerItem({
	className,
	scrollAnchor = false,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
	return (
		<MessageScrollerPrimitive.Item
			className={cn("min-w-0 shrink-0", className)}
			data-slot="message-scroller-item"
			scrollAnchor={scrollAnchor}
			{...props}
		/>
	);
}

function MessageScrollerButton({
	direction = "end",
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button>) {
	return (
		<MessageScrollerPrimitive.Button
			className={cn(
				"absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-sm transition-opacity duration-200 data-[active=false]:pointer-events-none data-[active=false]:opacity-0 data-[active=true]:opacity-100",
				className
			)}
			data-direction={direction}
			data-slot="message-scroller-button"
			direction={direction}
			render={<Button size="icon-sm" variant="secondary" />}
			{...props}
		>
			<ArrowDownIcon />
			<span className="sr-only">Scroll to bottom</span>
		</MessageScrollerPrimitive.Button>
	);
}

export {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
};
