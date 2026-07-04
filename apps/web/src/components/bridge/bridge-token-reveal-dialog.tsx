import { env } from "@better-agent/env/web";
import { CopyAction } from "@better-agent/ui/components/actions";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";

function bridgeCliCommand(token: string): string {
	return `better-agent-bridge --agent claude-code --dir . --token ${token} --server ${env.VITE_SERVER_URL}`;
}

/**
 * Shows a freshly-minted bridge token once, plus the ready-to-run CLI command
 * to connect a local agent with it. Mirrors token-reveal-dialog.tsx in
 * components/agents — a non-null `token` opens it.
 */
export function BridgeTokenRevealDialog({
	token,
	onClose,
}: {
	token: string | null;
	onClose: () => void;
}) {
	const command = token ? bridgeCliCommand(token) : "";
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			open={token !== null}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Bridge token</DialogTitle>
					<DialogDescription>
						Copy this token now — it won't be shown again. Anyone with it can
						start bridge sessions as you; revoke it if it leaks.
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-1.5">
					<code className="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
						{token}
					</code>
					{token ? <CopyAction label="Copy token" text={token} /> : null}
				</div>
				<div>
					<p className="mb-1 text-muted-foreground text-xs">
						Run this from your project directory:
					</p>
					<div className="flex items-center gap-1.5">
						<code className="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
							{command}
						</code>
						<CopyAction label="Copy command" text={command} />
					</div>
				</div>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}
