import { cn } from "@better-agent/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

const NEAR_BOTTOM_PX = 80;

interface StickCtx {
	atBottom: boolean;
	scrollRef: RefObject<HTMLDivElement | null>;
	scrollToBottom: () => void;
}

const ConversationContext = createContext<StickCtx | null>(null);

function useStick(): StickCtx {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [atBottom, setAtBottom] = useState(true);
	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, []);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) {
			// biome-ignore lint/suspicious/noEmptyBlockStatements: no-op cleanup when el is null
			return () => {};
		}
		const onScroll = () => {
			const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
			setAtBottom(distance < NEAR_BOTTOM_PX);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		const observer = new ResizeObserver(() => {
			if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
				el.scrollTop = el.scrollHeight;
			}
		});
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, []);
	return { scrollRef, atBottom, scrollToBottom };
}

export function Conversation({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const ctx = useStick();
	return (
		<ConversationContext.Provider value={ctx}>
			<div
				className={cn("relative flex-1 overflow-y-auto", className)}
				ref={ctx.scrollRef}
			>
				{children}
			</div>
		</ConversationContext.Provider>
	);
}

export function ConversationContent({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-4 p-4", className)}>{children}</div>
	);
}

export function ConversationScrollButton() {
	const ctx = useContext(ConversationContext);
	if (!ctx || ctx.atBottom) {
		return null;
	}
	return (
		<button
			aria-label="Scroll to bottom"
			className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-background p-2 shadow-md hover:bg-accent"
			onClick={ctx.scrollToBottom}
			type="button"
		>
			<ArrowDownIcon className="size-4" />
		</button>
	);
}
