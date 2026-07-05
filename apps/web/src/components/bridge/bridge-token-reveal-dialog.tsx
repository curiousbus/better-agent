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

/** The raw token is only shown once at creation and never stored server-side
 * again, so any command built outside that one reveal moment (the
 * waiting-for-CLI state, the past-conversations resume hint) is necessarily a
 * copy-paste template, not a live secret — this placeholder makes that
 * explicit rather than silently omitting `--token`. */
export const PLACEHOLDER_TOKEN = "<your-bridge-token>";

/** The ready-to-run CLI command for a freshly-minted bridge token. Exported
 * so the "Add local agent" flow (add-local-agent-dialog.tsx) can render the
 * exact same command without duplicating the format. */
export function bridgeCliCommand(token: string): string {
	return `better-agent-bridge --agent claude-code --dir . --token ${token} --server ${env.VITE_SERVER_URL}`;
}

/** The ready-to-run CLI command to resume a specific past claude conversation
 * (the "Past conversations" picker's copy-able hint — see
 * past-conversations.tsx). `dir` is the conversation's own recorded cwd when
 * known (from `SessionListItem.cwd`), falling back to `.` exactly like
 * `bridgeCliCommand`'s default — the same "run this from your project
 * directory" assumption. Full one-click resume (actually launching the CLI
 * for the user) is deferred; this only gets them the exact command to paste
 * into a terminal themselves. */
export function bridgeResumeCliCommand(
	token: string,
	dir: string | undefined,
	resumeId: string
): string {
	return `better-agent-bridge --agent claude-code --dir ${dir ?? "."} --resume ${resumeId} --token ${token} --server ${env.VITE_SERVER_URL}`;
}

/**
 * Token + copyable CLI command, the reveal-once body shared by
 * `BridgeTokenRevealDialog` (Tokens tab) and `AddLocalAgentDialog` (its
 * second step) — kept as one component so the two flows can never drift.
 */
export function BridgeTokenRevealContent({ token }: { token: string }) {
	const command = bridgeCliCommand(token);
	return (
		<>
			<div className="flex items-center gap-1.5">
				<code className="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
					{token}
				</code>
				<CopyAction label="Copy token" text={token} />
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
		</>
	);
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
				{token ? <BridgeTokenRevealContent token={token} /> : null}
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}
