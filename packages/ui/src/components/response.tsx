import { cn } from "@better-agent/ui/lib/utils";
import { memo } from "react";
import { Streamdown } from "streamdown";

// Streaming markdown renderer. Streamdown is a drop-in react-markdown
// replacement built for AI streaming: it repairs incomplete markdown and
// memoizes already-rendered blocks, so a growing message only re-renders its
// last block (no full re-parse / code re-highlight per token). `isAnimating`
// surfaces a typing caret while the reply streams.
export const Response = memo(function Response({
	children,
	className,
	isAnimating,
}: {
	children: string;
	className?: string;
	isAnimating?: boolean;
}) {
	return (
		<Streamdown
			caret="block"
			className={cn(
				"prose-sm max-w-none break-words text-sm leading-relaxed",
				"[&_a]:text-primary [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold",
				"[&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_ul]:list-disc [&_ul]:pl-5",
				"[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
				className
			)}
			components={{
				a: ({ children: c, href }) => (
					<a href={href} rel="noopener noreferrer" target="_blank">
						{c}
					</a>
				),
			}}
			isAnimating={isAnimating}
			shikiTheme={["github-light", "github-dark"]}
		>
			{children}
		</Streamdown>
	);
});
