import type { AppRouter } from "@better-agent/api/routers/index";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import type { RouterClient } from "@orpc/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

type SettingRow = Awaited<
	ReturnType<RouterClient<AppRouter>["settings"]["list"]>
>[number];

function SourceBadge({ source }: { source: SettingRow["source"] }) {
	if (source === "db") {
		return <Badge variant="secondary">Set in admin</Badge>;
	}
	if (source === "env") {
		return <Badge variant="outline">Using env</Badge>;
	}
	return <Badge variant="outline">Not set</Badge>;
}

function useSettingMutations(key: string, onSaved: () => void) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.settings.list.key() });

	const setMutation = useMutation(
		orpc.settings.set.mutationOptions({
			onSuccess: () => {
				invalidate();
				onSaved();
				toast.success("Saved");
			},
			onError: (error) => toast.error(error.message),
		})
	);

	const clearMutation = useMutation(
		orpc.settings.clear.mutationOptions({
			onSuccess: () => {
				invalidate();
				toast.success("Cleared");
			},
			onError: (error) => toast.error(error.message),
		})
	);

	return { setMutation, clearMutation, key };
}

function SettingRowActions({
	row,
	mutations,
	value,
	setValue,
}: {
	row: SettingRow;
	mutations: ReturnType<typeof useSettingMutations>;
	value: string;
	setValue: (v: string) => void;
}) {
	const { setMutation, clearMutation } = mutations;
	return (
		<div className="flex shrink-0 items-center gap-2">
			<Input
				className="w-56"
				onChange={(e) => setValue(e.target.value)}
				placeholder="New value…"
				type="password"
				value={value}
			/>
			<Button
				disabled={value === "" || setMutation.isPending}
				onClick={() => setMutation.mutate({ key: row.key, value })}
				size="sm"
			>
				Save
			</Button>
			{row.source === "db" && (
				<Button
					disabled={clearMutation.isPending}
					onClick={() => clearMutation.mutate({ key: row.key })}
					size="sm"
					variant="outline"
				>
					Clear
				</Button>
			)}
		</div>
	);
}

function SettingRowItem({ row }: { row: SettingRow }) {
	const [value, setValue] = useState("");
	const mutations = useSettingMutations(row.key, () => setValue(""));

	return (
		<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-accent">
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{row.label}</span>
					<SourceBadge source={row.source} />
				</div>
				<span className="text-muted-foreground text-xs">{row.help}</span>
			</div>
			<SettingRowActions
				mutations={mutations}
				row={row}
				setValue={setValue}
				value={value}
			/>
		</div>
	);
}

function SettingsList() {
	const settingsQuery = useQuery(orpc.settings.list.queryOptions());
	const rows = settingsQuery.data ?? [];

	return (
		<div className="flex flex-col">
			{rows.map((row) => (
				<SettingRowItem key={row.key} row={row} />
			))}
		</div>
	);
}

function SettingsPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<h1 className="font-semibold text-lg">Settings</h1>
			<SettingsList />
		</div>
	);
}
