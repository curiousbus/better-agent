import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { ComposioToolkitRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import {
	ConnectKeyDialog,
	type KeyConnectTarget,
	keySchemeFor,
} from "./connect-key-dialog";
import { queryPlaceholder } from "./placeholder";

const COLUMN_COUNT = 3;

function useToolkitConnect() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.connect.mutationOptions({
			onSuccess: (result) => {
				if (result.redirectUrl) {
					window.open(result.redirectUrl, "_blank", "noopener,noreferrer");
				}
				queryClient.invalidateQueries({
					queryKey: orpc.composio.connections.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function ToolkitRow({
	toolkit,
	isPending,
	onConnect,
}: {
	toolkit: ComposioToolkitRow;
	isPending: boolean;
	onConnect: (toolkit: ComposioToolkitRow) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">{toolkit.name}</TableCell>
			<TableCell className="font-mono text-muted-foreground">
				{toolkit.slug}
			</TableCell>
			<TableCell className="text-right">
				<Button
					disabled={isPending}
					onClick={() => onConnect(toolkit)}
					size="xs"
					variant="outline"
				>
					Connect
				</Button>
			</TableCell>
		</TableRow>
	);
}

function ToolkitsTable({
	rows,
	isLoading,
	isPending,
	placeholder,
	onConnect,
}: {
	rows: ComposioToolkitRow[];
	isLoading: boolean;
	isPending: boolean;
	placeholder: string;
	onConnect: (toolkit: ComposioToolkitRow) => void;
}) {
	return (
		<div className="max-h-96 overflow-auto rounded-lg border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Toolkit</TableHead>
						<TableHead>Slug</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading || rows.length === 0 ? (
						<TableRow>
							<TableCell
								className="h-20 text-center text-muted-foreground"
								colSpan={COLUMN_COUNT}
							>
								{placeholder}
							</TableCell>
						</TableRow>
					) : (
						rows.map((toolkit) => (
							<ToolkitRow
								isPending={isPending}
								key={toolkit.slug}
								onConnect={onConnect}
								toolkit={toolkit}
							/>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function ToolkitSearch({
	search,
	onSearch,
}: {
	search: string;
	onSearch: (v: string) => void;
}) {
	return (
		<div className="relative">
			<SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search toolkits"
				className="pl-8"
				onChange={(event) => onSearch(event.target.value)}
				placeholder="Search toolkits"
				value={search}
			/>
		</div>
	);
}

export function ToolkitsSection({ accountId }: { accountId: string }) {
	const [search, setSearch] = useState("");
	const [keyTarget, setKeyTarget] = useState<KeyConnectTarget | null>(null);
	const toolkits = useQuery(
		orpc.composio.toolkits.queryOptions({ input: { accountId } })
	);
	const connect = useToolkitConnect();

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		const all = toolkits.data ?? [];
		return term
			? all.filter(
					(t) =>
						t.name.toLowerCase().includes(term) ||
						t.slug.toLowerCase().includes(term)
				)
			: all;
	}, [toolkits.data, search]);

	// OAuth toolkits redirect; key-authenticated ones (tavily etc.) prompt for
	// the service's key instead — authorize() would just error for those.
	const handleConnect = (toolkit: ComposioToolkitRow) => {
		const scheme = keySchemeFor(toolkit);
		if (scheme) {
			setKeyTarget({ toolkit, scheme });
		} else {
			connect.mutate({ accountId, toolkit: toolkit.slug });
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Available toolkits</h2>
			<ToolkitSearch onSearch={setSearch} search={search} />
			<ToolkitsTable
				isLoading={toolkits.isLoading}
				isPending={connect.isPending}
				onConnect={handleConnect}
				placeholder={queryPlaceholder(toolkits, "No toolkits found.")}
				rows={filtered}
			/>
			<ConnectKeyDialog
				accountId={accountId}
				onClose={() => setKeyTarget(null)}
				target={keyTarget}
			/>
		</div>
	);
}
