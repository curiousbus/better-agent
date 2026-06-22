import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

const COPIED_RESET_MS = 1500;

function useHighlighted(code: string, lang: string): string | null {
	const [html, setHtml] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		codeToHtml(code, {
			lang: lang || "text",
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		})
			.then((result) => {
				if (active) {
					setHtml(result);
				}
			})
			.catch(() => {
				if (active) {
					setHtml(null);
				}
			});
		return () => {
			active = false;
		};
	}, [code, lang]);
	return html;
}

function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			aria-label="Copy code"
			className="absolute top-2 right-2 rounded-md border bg-background/70 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
			onClick={() => {
				navigator.clipboard.writeText(code).then(
					() => {
						setCopied(true);
						setTimeout(() => setCopied(false), COPIED_RESET_MS);
					},
					() => {
						// clipboard blocked (non-secure context / no permission): no-op
					}
				);
			}}
			type="button"
		>
			{copied ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CopyIcon className="size-3.5" />
			)}
		</button>
	);
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const html = useHighlighted(code, lang);
	return (
		<div className="group relative my-2">
			<CopyButton code={code} />
			{html ? (
				<div
					className={cn(
						"overflow-x-auto rounded-lg border text-sm [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-3",
						"[&_code]:font-mono"
					)}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki 输出的是已转义的高亮 HTML
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-sm">
					<code>{code}</code>
				</pre>
			)}
		</div>
	);
}
