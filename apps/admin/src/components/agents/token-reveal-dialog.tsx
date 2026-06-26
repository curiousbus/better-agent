import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

const COPIED_RESET_MS = 1500;

function CopyTokenButton({ token }: { token: string }) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		navigator.clipboard.writeText(token).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_RESET_MS);
			},
			() => {
				// clipboard blocked (non-secure context / no permission): no-op
			}
		);
	};
	return (
		<Button onClick={copy} type="button" variant="outline">
			<span className="t-icon-swap" data-state={copied ? "b" : "a"}>
				<CopyIcon className="t-icon size-3.5" data-icon="a" />
				<CheckIcon className="t-icon size-3.5" data-icon="b" />
			</span>
			{copied ? "Copied" : "Copy token"}
		</Button>
	);
}

/**
 * Shows a freshly-minted agent token once, in a modal the user must explicitly
 * dismiss, with a copy button. Driven by `token`: a non-null value opens it.
 */
export function TokenRevealDialog({
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
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Agent token</DialogTitle>
					<DialogDescription>
						Use this token to chat with the agent from an external client (the
						admin reuses it automatically). Anyone with it can chat as this
						agent — regenerate to revoke the old one.
					</DialogDescription>
				</DialogHeader>
				<code className="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
					{token}
				</code>
				<DialogFooter showCloseButton>
					{token ? <CopyTokenButton token={token} /> : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
