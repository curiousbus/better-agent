import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import type { McpServerRow } from "@/utils/api-types";
import {
	buildExport,
	EXPORT_TARGETS,
	type ExportResult,
	type ExportTargetId,
} from "./mcp-export";

function downloadFile(filename: string, content: string): void {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function SetupDialog({
	server,
	target,
	result,
	onClose,
}: {
	server: McpServerRow;
	target: string;
	result: ExportResult;
	onClose: () => void;
}) {
	return (
		<Dialog onOpenChange={(open) => !open && onClose()} open>
			<DialogContent className="w-full sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						Add “{server.name}” to {target}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 text-sm">
					<p className="text-muted-foreground">
						Downloaded <code className="font-mono">{result.filename}</code>. To
						configure:
					</p>
					<ol className="flex list-decimal flex-col gap-1.5 pl-5">
						{result.howto.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
					{result.needsToken ? (
						<p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs">
							This server uses an auth token. Replace{" "}
							<code className="font-mono">&lt;YOUR_BEARER_TOKEN&gt;</code> with
							your own token — stored tokens are never exported.
						</p>
					) : null}
					<pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
						{result.content}
					</pre>
				</div>
				<DialogFooter>
					<Button onClick={onClose} type="button">
						已知晓
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Per-server "Export" menu: pick a target → download its config + show setup. */
export function ExportMcpMenu({ server }: { server: McpServerRow }) {
	const [active, setActive] = useState<{
		target: string;
		result: ExportResult;
	} | null>(null);

	const onExport = (targetId: ExportTargetId, label: string) => {
		const result = buildExport(targetId, server);
		downloadFile(result.filename, result.content);
		setActive({ target: label, result });
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="Export config"
							size="icon-sm"
							title="Export config"
							type="button"
							variant="ghost"
						/>
					}
				>
					<DownloadIcon className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{EXPORT_TARGETS.map((target) => (
						<DropdownMenuItem
							key={target.id}
							onClick={() => onExport(target.id, target.label)}
						>
							Export to {target.label}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			{active ? (
				<SetupDialog
					onClose={() => setActive(null)}
					result={active.result}
					server={server}
					target={active.target}
				/>
			) : null}
		</>
	);
}
