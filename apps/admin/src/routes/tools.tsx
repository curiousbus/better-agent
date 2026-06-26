import type { AppRouter } from "@better-agent/api/routers/index";
import { Badge } from "@better-agent/ui/components/badge";
import { Input } from "@better-agent/ui/components/input";
import type { RouterClient } from "@orpc/server";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/tools")({
	component: ToolsPage,
});

type ToolkitRow = Awaited<
	ReturnType<RouterClient<AppRouter>["composio"]["listToolkits"]>
>["toolkits"][number];

function ToolkitRow({ row }: { row: ToolkitRow }) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{row.name}</span>
					<span className="font-mono text-muted-foreground text-xs">
						{row.slug}
					</span>
				</div>
				<p className="truncate text-muted-foreground text-xs">
					{row.description}
				</p>
			</div>
			<div className="shrink-0">
				{row.needsAuth ? (
					<Badge variant="outline">needs connection</Badge>
				) : (
					<Badge variant="secondary">ready</Badge>
				)}
			</div>
		</div>
	);
}

function ToolkitList({ toolkits }: { toolkits: ToolkitRow[] }) {
	const [search, setSearch] = useState("");

	const filtered =
		search.trim() === ""
			? toolkits
			: toolkits.filter((t) => {
					const q = search.toLowerCase();
					return (
						t.name.toLowerCase().includes(q) ??
						t.slug.toLowerCase().includes(q) ??
						(t.description ?? "").toLowerCase().includes(q)
					);
				});

	return (
		<div className="flex flex-col gap-3">
			<Input
				onChange={(e) => setSearch(e.target.value)}
				placeholder="搜索工具集…"
				value={search}
			/>
			<div className="flex flex-col">
				{filtered.length === 0 ? (
					<p className="px-2 py-4 text-center text-muted-foreground text-sm">
						{toolkits.length === 0
							? "暂无可用工具(或拉取失败)"
							: "没有匹配的工具"}
					</p>
				) : (
					filtered.map((row) => <ToolkitRow key={row.slug} row={row} />)
				)}
			</div>
		</div>
	);
}

function ToolsContent() {
	const { data, isPending } = useQuery(
		orpc.composio.listToolkits.queryOptions()
	);

	if (isPending) {
		return <p className="text-muted-foreground text-sm">Loading…</p>;
	}

	if (data?.configured === false) {
		return (
			<p className="text-muted-foreground text-sm">
				Composio 未配置 — 在 server 设置{" "}
				<code className="font-mono">COMPOSIO_API_KEY</code>{" "}
				后这里会列出可用工具。
			</p>
		);
	}

	return <ToolkitList toolkits={data?.toolkits ?? []} />;
}

function ToolsPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">Tools</h1>
				<p className="text-muted-foreground text-sm">
					这些是 composio 提供的工具集。在某个 agent 的编辑向导 → Tools
					步骤里,把需要的 toolkit slug 加给该 agent。
				</p>
			</div>
			<ToolsContent />
		</div>
	);
}
