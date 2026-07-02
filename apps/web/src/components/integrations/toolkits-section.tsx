import { Badge } from "@better-agent/ui/components/badge";
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
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ComposioToolkitRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import {
	ConnectKeyDialog,
	type KeyConnectTarget,
	keySchemeFor,
} from "./connect-key-dialog";
import { queryPlaceholder } from "./placeholder";
import { useOauthPopup } from "./use-oauth-popup";

const COLUMN_COUNT = 3;

function ToolkitRow({
	toolkit,
	connected,
	isPending,
	onConnect,
}: {
	toolkit: ComposioToolkitRow;
	connected: boolean;
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
				{connected ? (
					<Badge className="gap-1" variant="secondary">
						<CheckIcon className="size-3" />
						Connected
					</Badge>
				) : (
					<Button
						disabled={isPending}
						onClick={() => onConnect(toolkit)}
						size="xs"
						variant="outline"
					>
						Connect
					</Button>
				)}
			</TableCell>
		</TableRow>
	);
}

function EmptyRow({ placeholder }: { placeholder: string }) {
	return (
		<TableRow>
			<TableCell
				className="h-20 text-center text-muted-foreground"
				colSpan={COLUMN_COUNT}
			>
				{placeholder}
			</TableCell>
		</TableRow>
	);
}

function ToolkitsTable({
	rows,
	connectedSlugs,
	isLoading,
	isPending,
	placeholder,
	onConnect,
}: {
	rows: ComposioToolkitRow[];
	connectedSlugs: Set<string>;
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
						<EmptyRow placeholder={placeholder} />
					) : (
						rows.map((toolkit) => (
							<ToolkitRow
								connected={connectedSlugs.has(toolkit.slug.toLowerCase())}
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

function useToolkitCatalog(accountId: string, search: string) {
	const toolkits = useQuery(
		orpc.composio.toolkits.queryOptions({ input: { accountId } })
	);
	// Shares the connections cache with ConnectionsSection, so a finished
	// connect flips the row to "Connected" without extra requests.
	const connections = useQuery(
		orpc.composio.connections.queryOptions({ input: { accountId } })
	);
	const connectedSlugs = useMemo(
		() =>
			new Set(
				(connections.data ?? [])
					.filter((c) => c.active)
					.map((c) => c.toolkitSlug.toLowerCase())
			),
		[connections.data]
	);
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
	return { toolkits, connectedSlugs, filtered };
}

export function ToolkitsSection({ accountId }: { accountId: string }) {
	const [search, setSearch] = useState("");
	const [keyTarget, setKeyTarget] = useState<KeyConnectTarget | null>(null);
	const { toolkits, connectedSlugs, filtered } = useToolkitCatalog(
		accountId,
		search
	);
	const oauth = useOauthPopup(accountId);

	// OAuth toolkits authorize in a small centered popup; key-authenticated ones
	// (tavily etc.) prompt for the service's key — authorize() would error there.
	const handleConnect = (toolkit: ComposioToolkitRow) => {
		const scheme = keySchemeFor(toolkit);
		if (scheme) {
			setKeyTarget({ toolkit, scheme });
		} else {
			oauth.start(toolkit.slug);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Available toolkits</h2>
			<ToolkitSearch onSearch={setSearch} search={search} />
			<ToolkitsTable
				connectedSlugs={connectedSlugs}
				isLoading={toolkits.isLoading}
				isPending={oauth.isPending}
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
