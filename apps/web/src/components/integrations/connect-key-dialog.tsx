import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { ComposioToolkitRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export type KeyScheme = "API_KEY" | "BEARER_TOKEN";

export interface KeyConnectTarget {
	scheme: KeyScheme;
	toolkit: ComposioToolkitRow;
}

// Which connect flow a toolkit needs. OAuth wins when available; otherwise a
// key-authenticated toolkit (tavily etc.) prompts for the service's key.
export function keySchemeFor(toolkit: ComposioToolkitRow): KeyScheme | null {
	const schemes = toolkit.authSchemes;
	if (schemes.includes("OAUTH2") || schemes.includes("OAUTH1")) {
		return null;
	}
	if (schemes.includes("API_KEY")) {
		return "API_KEY";
	}
	if (schemes.includes("BEARER_TOKEN")) {
		return "BEARER_TOKEN";
	}
	return null;
}

function useConnectWithKey(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.connectWithKey.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.composio.connections.key(),
				});
				toast.success("Connected");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function KeyForm({
	target,
	pending,
	onSubmit,
}: {
	target: KeyConnectTarget;
	pending: boolean;
	onSubmit: (key: string) => void;
}) {
	const [key, setKey] = useState("");
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(key);
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="toolkit-key">
					{target.scheme === "BEARER_TOKEN" ? "Access token" : "API key"}
				</Label>
				<Input
					autoComplete="off"
					id="toolkit-key"
					onChange={(event) => setKey(event.target.value)}
					placeholder={`Your ${target.toolkit.name} key`}
					required
					type="password"
					value={key}
				/>
			</div>
			<Button className="self-end" disabled={pending} type="submit">
				{pending ? "Connecting…" : "Connect"}
			</Button>
		</form>
	);
}

/** Asks for the target service's key (e.g. a Tavily API key) and connects. */
export function ConnectKeyDialog({
	accountId,
	target,
	onClose,
}: {
	accountId: string;
	target: KeyConnectTarget | null;
	onClose: () => void;
}) {
	const connect = useConnectWithKey(onClose);
	return (
		<Dialog onOpenChange={(open) => !open && onClose()} open={target !== null}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect {target?.toolkit.name}</DialogTitle>
				</DialogHeader>
				{target ? (
					<KeyForm
						onSubmit={(key) =>
							connect.mutate({
								accountId,
								toolkit: target.toolkit.slug,
								scheme: target.scheme,
								key,
							})
						}
						pending={connect.isPending}
						target={target}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
