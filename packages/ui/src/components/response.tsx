import { CodeBlock } from "@better-agent/ui/components/code-block";
import { cn } from "@better-agent/ui/lib/utils";
import type { ComponentProps } from "react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LANG_RE = /language-(\w+)/;
const TRAILING_NL_RE = /\n$/;

function CodeRenderer({ className, children }: ComponentProps<"code">) {
	const match = LANG_RE.exec(className ?? "");
	const text = String(children ?? "").replace(TRAILING_NL_RE, "");
	if (match) {
		return <CodeBlock code={text} lang={match[1] ?? "text"} />;
	}
	return (
		<code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">
			{children}
		</code>
	);
}

export const Response = memo(function Response({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"prose-sm max-w-none break-words text-sm leading-relaxed",
				"[&_a]:text-primary [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold",
				"[&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_ul]:list-disc [&_ul]:pl-5",
				"[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
				className
			)}
		>
			<ReactMarkdown
				components={{
					code: CodeRenderer,
					a: ({ children: c, href }) => (
						<a href={href} rel="noopener noreferrer" target="_blank">
							{c}
						</a>
					),
				}}
				remarkPlugins={[remarkGfm]}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
});
