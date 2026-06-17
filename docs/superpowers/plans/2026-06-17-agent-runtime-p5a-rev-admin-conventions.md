# Plan 5a-rev：admin UI 规范化（三段式列表 + modal 增改 + popover 删除确认）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用户定的 admin 通用 UI 规范落到已建的 Providers 页：① 列表三段式（搜索 + 操作位 / 表格 / 分页）；② 增改用 **modal**（Dialog）；③ 删除用 **popover 确认**。顺带建一套可复用的列表脚手架（搜索 + 客户端分页），供 Plan 5b/5c 复用。

**Architecture:** 新增 `apps/admin/src/components/list/`：`useListView`（客户端过滤 + 分页 hook）、`ListToolbar`（搜索框 + 操作位）、`Pagination`（上一页/下一页 + 页码）。三张卡（Catalog/Credentials/Models）改用该脚手架；Credentials 的增改改为 `Dialog` 弹窗、删除改为 `Popover` 确认。Dialog/Popover 组件已加入 `@better-agent/ui`（commit `f165f88`，base-ui `open`/`onOpenChange`）。规范见记忆 `admin-ui-conventions`。

**Tech Stack:** React 19 · TanStack Router/Query · `@orpc/tanstack-query` · `@better-agent/ui`（base-ui shadcn：`Dialog`/`Popover`/`Button`/`Input`/`Label`/`Checkbox`/`Card`/`Skeleton`）· Tailwind v4。

## Global Constraints

- 规范（记忆 `admin-ui-conventions`）：列表页三段式＝【搜索 + 添加/操作按钮】/【表格】/【分页】；增改用 modal；删除用 popover 确认。**只读列表**（Catalog/Models，无增改删）保留搜索 + 分页，操作位放对应动作（Catalog=Refresh，Models=provider 选择器），不放 Add。CRUD 列表（Credentials）走全套。
- 每个 commit 前 `pnpm fix`；apps 依赖区间镜像 `apps/web`（含 `^`）；文件名 kebab-case；**函数/组件 ≤50 行**（超限拆子组件，逻辑不变）；禁 `any`/`console`；`key` 用稳定 id；JSX 用语义元素 + 表单控件配 `id`/`htmlFor` 或 `aria-label`（biome `noLabelWithoutControl`）。
- 数据经 `orpc`：`useQuery(orpc.X.queryOptions({ input? }))`、`useMutation(orpc.X.mutationOptions({ onSuccess, onError }))`、失效 `queryClient.invalidateQueries({ queryKey: orpc.X.key() })`、错误 `toast.error(error.message)`、加载 `Skeleton`。查询错误另有全局 `queryCache.onError` toast 兜底。
- 不 import `packages/agent`：行类型用既有 `@/utils/api-types`。
- **验证**：手动/浏览器 e2e。每个任务自动门禁 = `pnpm -F @better-agent/admin build` 成功；最终任务做完整手动 e2e。
- base-ui 控件：`Dialog`/`Popover` 用 `open` + `onOpenChange`（首参 `boolean`，`onOpenChange={setOpen}` 即可）；`Checkbox` 用 `checked` + `onCheckedChange`（首参 `boolean`，`checked === true` 收敛）。
- **范围**：仅 Providers 页规范化 + 列表脚手架。Agents/Sessions 页（5b/5c）沿用脚手架，本计划不建。

---

## 文件结构

**Create:**
- `apps/admin/src/components/list/use-list-view.ts` — 过滤 + 分页 hook
- `apps/admin/src/components/list/list-toolbar.tsx` — 搜索 + 操作位
- `apps/admin/src/components/list/pagination.tsx` — 分页控件

**Modify（按新规范重写）:**
- `apps/admin/src/components/providers/catalog-card.tsx`
- `apps/admin/src/components/providers/credentials-card.tsx`
- `apps/admin/src/components/providers/models-card.tsx`

**Create（Task 5）:** `apps/admin/README.md`

---

## Task 1: 可复用列表脚手架（搜索 + 分页）

**Files:** Create `use-list-view.ts`、`list-toolbar.tsx`、`pagination.tsx`（均在 `apps/admin/src/components/list/`）。
**Interfaces:**
- Produces: `useListView<T>(rows, { filter, pageSize? })` → `{ search, setSearch, page, setPage, pageRows, pageCount, total }`；`<ListToolbar search onSearch placeholder action? />`；`<Pagination page pageCount total onPage />`。Task 2/3/4 复用。

- [ ] **Step 1: 写 `use-list-view.ts`**

```ts
import { useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 10;

export interface ListView<T> {
	search: string;
	setSearch: (value: string) => void;
	page: number;
	setPage: (page: number) => void;
	pageRows: T[];
	pageCount: number;
	total: number;
}

export function useListView<T>(
	rows: T[],
	options: { filter: (row: T, query: string) => boolean; pageSize?: number }
): ListView<T> {
	const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	const [search, setSearchState] = useState("");
	const [page, setPage] = useState(0);

	const filtered = useMemo(
		() => rows.filter((row) => options.filter(row, search.trim().toLowerCase())),
		[rows, search, options.filter]
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const clampedPage = Math.min(page, pageCount - 1);
	const pageRows = filtered.slice(
		clampedPage * pageSize,
		clampedPage * pageSize + pageSize
	);

	const setSearch = (value: string) => {
		setSearchState(value);
		setPage(0);
	};

	return {
		search,
		setSearch,
		page: clampedPage,
		setPage,
		pageRows,
		pageCount,
		total: filtered.length,
	};
}
```

- [ ] **Step 2: 写 `list-toolbar.tsx`**

```tsx
import { Input } from "@better-agent/ui/components/input";
import type { ReactNode } from "react";

export function ListToolbar({
	search,
	onSearch,
	placeholder,
	action,
}: {
	search: string;
	onSearch: (value: string) => void;
	placeholder: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<Input
				aria-label="Search"
				className="max-w-xs"
				onChange={(event) => onSearch(event.target.value)}
				placeholder={placeholder}
				value={search}
			/>
			{action}
		</div>
	);
}
```

- [ ] **Step 3: 写 `pagination.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";

export function Pagination({
	page,
	pageCount,
	total,
	onPage,
}: {
	page: number;
	pageCount: number;
	total: number;
	onPage: (page: number) => void;
}) {
	return (
		<div className="flex items-center justify-between text-muted-foreground text-xs">
			<span>{total} items</span>
			<div className="flex items-center gap-2">
				<Button
					disabled={page <= 0}
					onClick={() => onPage(page - 1)}
					size="xs"
					variant="outline"
				>
					Prev
				</Button>
				<span>
					{page + 1} / {pageCount}
				</span>
				<Button
					disabled={page >= pageCount - 1}
					onClick={() => onPage(page + 1)}
					size="xs"
					variant="outline"
				>
					Next
				</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: 构建 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
```bash
pnpm fix
git add apps/admin/src/components/list
git commit -m "feat(admin): add reusable list view hook, toolbar, and pagination"
```

---

## Task 2: Catalog 卡片规范化（搜索 + 分页，Refresh 在操作位）

**Files:** Modify `apps/admin/src/components/providers/catalog-card.tsx`
**Interfaces:** Consumes Task 1 的 `useListView`/`ListToolbar`/`Pagination`；`orpc.providers.catalogList`/`catalogRefresh`。

- [ ] **Step 1: 重写 `catalog-card.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function matchProvider(row: ProviderCatalogRow, query: string): boolean {
	return (
		row.providerId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function CatalogTable({ rows }: { rows: ProviderCatalogRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No providers.</p>;
	}
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b text-left text-muted-foreground">
					<th className="py-1 font-medium">Provider</th>
					<th className="font-medium">Name</th>
					<th className="font-medium">npm</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr className="border-b/40" key={row.providerId}>
						<td className="py-1 font-mono">{row.providerId}</td>
						<td>{row.name}</td>
						<td className="text-muted-foreground">{row.npm ?? "—"}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function CatalogCard() {
	const queryClient = useQueryClient();
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const view = useListView(catalog.data ?? [], { filter: matchProvider });
	const refresh = useMutation(
		orpc.providers.catalogRefresh.mutationOptions({
			onSuccess: () => {
				toast.success("Catalog refreshed");
				queryClient.invalidateQueries({
					queryKey: orpc.providers.catalogList.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);

	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Provider catalog</h2>
			<ListToolbar
				action={
					<Button
						disabled={refresh.isPending}
						onClick={() => refresh.mutate(undefined)}
						size="sm"
					>
						{refresh.isPending ? "Refreshing…" : "Refresh catalog"}
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search providers…"
				search={view.search}
			/>
			{catalog.isLoading ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<CatalogTable rows={view.pageRows} />
			)}
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</Card>
	);
}
```

- [ ] **Step 2: 构建 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
```bash
pnpm fix
git add apps/admin/src/components/providers/catalog-card.tsx
git commit -m "refactor(admin): catalog card with search and pagination"
```

---

## Task 3: Credentials 卡片规范化（搜索 + 分页 + Add/Edit modal + 删除 popover 确认）

**Files:** Modify `apps/admin/src/components/providers/credentials-card.tsx`
**Interfaces:** Consumes Task 1 脚手架、`@better-agent/ui` 的 `Dialog`/`Popover`、`orpc.providers.{catalogList,credentialsList,credentialsUpsert,credentialsDelete}`。

> 组件较多，拆文件内多个 ≤50 行子组件：`CredentialDialog`（增改弹窗）、`CredentialFields`（表单字段）、`DeleteConfirm`（删除 popover）、`CredentialRows`（表格行）、`CredentialsCard`（组合）。Edit 复用同一弹窗：providerId 预选且禁用、baseURL/enabled 预填、apiKey 需重填（仅有末四位、无法回显原 key）。

- [ ] **Step 1: 重写 `credentials-card.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { CredentialRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

interface FormState {
	providerId: string;
	apiKey: string;
	baseURL: string;
	enabled: boolean;
}

const EMPTY_FORM: FormState = {
	providerId: "",
	apiKey: "",
	baseURL: "",
	enabled: true,
};

function matchCredential(row: CredentialRow, query: string): boolean {
	return row.providerId.toLowerCase().includes(query);
}

function CredentialFields({
	form,
	setForm,
	providers,
	editing,
}: {
	form: FormState;
	setForm: (form: FormState) => void;
	providers: ProviderCatalogRow[];
	editing: boolean;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-provider">Provider</Label>
				<select
					className="h-8 border bg-transparent px-2 text-sm disabled:opacity-60"
					disabled={editing}
					id="cred-provider"
					onChange={(event) =>
						setForm({ ...form, providerId: event.target.value })
					}
					required
					value={form.providerId}
				>
					<option value="">Select…</option>
					{providers.map((provider) => (
						<option key={provider.providerId} value={provider.providerId}>
							{provider.providerId}
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-key">API key</Label>
				<Input
					id="cred-key"
					onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
					required
					value={form.apiKey}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-base">Base URL (optional)</Label>
				<Input
					id="cred-base"
					onChange={(event) => setForm({ ...form, baseURL: event.target.value })}
					value={form.baseURL}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm" htmlFor="cred-enabled">
				<Checkbox
					checked={form.enabled}
					id="cred-enabled"
					onCheckedChange={(checked) =>
						setForm({ ...form, enabled: checked === true })
					}
				/>
				Enabled
			</label>
		</div>
	);
}

function CredentialDialog({
	open,
	onOpenChange,
	initial,
	providers,
	onSubmit,
	pending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial: FormState | null;
	providers: ProviderCatalogRow[];
	onSubmit: (form: FormState) => void;
	pending: boolean;
}) {
	const [form, setForm] = useState<FormState>(initial ?? EMPTY_FORM);
	const editing = (initial?.providerId ?? "") !== "";
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{editing ? "Edit credential" : "Add credential"}</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit(form);
					}}
				>
					<CredentialFields
						editing={editing}
						form={form}
						providers={providers}
						setForm={setForm}
					/>
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => onOpenChange(false)}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={pending} size="sm" type="submit">
							Save
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function DeleteConfirm({ onConfirm }: { onConfirm: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger render={<Button size="xs" variant="destructive" />}>
				Delete
			</PopoverTrigger>
			<PopoverContent>
				<p className="text-sm">Delete this credential?</p>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
						size="xs"
						variant="destructive"
					>
						Confirm
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function CredentialRows({
	rows,
	onEdit,
	onDelete,
}: {
	rows: CredentialRow[];
	onEdit: (row: CredentialRow) => void;
	onDelete: (providerId: string) => void;
}) {
	return (
		<tbody>
			{rows.map((row) => (
				<tr className="border-b/40" key={row.providerId}>
					<td className="py-1 font-mono">{row.providerId}</td>
					<td className="font-mono text-muted-foreground">…{row.last4}</td>
					<td className="text-muted-foreground">{row.baseURL ?? "—"}</td>
					<td className={row.enabled ? "text-green-500" : "text-muted-foreground"}>
						{row.enabled ? "enabled" : "disabled"}
					</td>
					<td className="flex justify-end gap-2 py-1">
						<Button onClick={() => onEdit(row)} size="xs" variant="outline">
							Edit
						</Button>
						<DeleteConfirm onConfirm={() => onDelete(row.providerId)} />
					</td>
				</tr>
			))}
		</tbody>
	);
}

export function CredentialsCard() {
	const queryClient = useQueryClient();
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const credentials = useQuery(orpc.providers.credentialsList.queryOptions());
	const view = useListView(credentials.data ?? [], { filter: matchCredential });
	const [dialog, setDialog] = useState<{ open: boolean; initial: FormState | null }>(
		{ open: false, initial: null }
	);
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.providers.credentialsList.key(),
		});
	const upsert = useMutation(
		orpc.providers.credentialsUpsert.mutationOptions({
			onSuccess: () => {
				toast.success("Credential saved");
				setDialog({ open: false, initial: null });
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.providers.credentialsDelete.mutationOptions({
			onSuccess: () => {
				toast.success("Credential deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);

	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Credentials</h2>
			<ListToolbar
				action={
					<Button
						onClick={() => setDialog({ open: true, initial: EMPTY_FORM })}
						size="sm"
					>
						Add credential
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search credentials…"
				search={view.search}
			/>
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-muted-foreground">
						<th className="py-1 font-medium">Provider</th>
						<th className="font-medium">Key</th>
						<th className="font-medium">Base URL</th>
						<th className="font-medium">Status</th>
						<th />
					</tr>
				</thead>
				<CredentialRows
					onDelete={(providerId) => remove.mutate({ providerId })}
					onEdit={(row) =>
						setDialog({
							open: true,
							initial: {
								providerId: row.providerId,
								apiKey: "",
								baseURL: row.baseURL ?? "",
								enabled: row.enabled,
							},
						})
					}
					rows={view.pageRows}
				/>
			</table>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
			{dialog.open ? (
				<CredentialDialog
					initial={dialog.initial}
					key={dialog.initial?.providerId ?? "new"}
					onOpenChange={(open) => setDialog({ open, initial: dialog.initial })}
					onSubmit={(form) =>
						upsert.mutate({
							providerId: form.providerId,
							apiKey: form.apiKey,
							baseURL: form.baseURL.trim() === "" ? null : form.baseURL.trim(),
							enabled: form.enabled,
						})
					}
					open={dialog.open}
					pending={upsert.isPending}
					providers={catalog.data ?? []}
				/>
			) : null}
		</Card>
	);
}
```

> 说明：① `CredentialDialog` 用 `key`（providerId 或 "new"）强制每次打开重置内部 `form` 初值；② `PopoverTrigger`/`DialogTrigger` 的 base-ui `render` prop 用来把触发器渲染成自定义 `Button`（base-ui 模式）；若该版本 `render` 签名不符，改用 `<PopoverTrigger><Button .../></PopoverTrigger>` 的 asChild 等价写法（按组件实际 API 微调，报告之）。③ Edit 时 providerId 预选且禁用、apiKey 需重填（仅存末四位）。

- [ ] **Step 2: 构建 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
```bash
pnpm fix
git add apps/admin/src/components/providers/credentials-card.tsx
git commit -m "refactor(admin): credentials card with modal add/edit and delete confirm"
```

---

## Task 4: Models 卡片规范化（provider 选择 + 搜索 + 分页）

**Files:** Modify `apps/admin/src/components/providers/models-card.tsx`
**Interfaces:** Consumes Task 1 脚手架、`orpc.providers.{catalogList,modelsList}`。

- [ ] **Step 1: 重写 `models-card.tsx`**

```tsx
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ModelRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function matchModel(row: ModelRow, query: string): boolean {
	return (
		row.modelId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function ProviderPicker({
	providers,
	value,
	onChange,
}: {
	providers: ProviderCatalogRow[];
	value: string;
	onChange: (providerId: string) => void;
}) {
	return (
		<select
			aria-label="Provider"
			className="h-8 border bg-transparent px-2 text-sm"
			onChange={(event) => onChange(event.target.value)}
			value={value}
		>
			<option value="">Select a provider…</option>
			{providers.map((provider) => (
				<option key={provider.providerId} value={provider.providerId}>
					{provider.providerId}
				</option>
			))}
		</select>
	);
}

function ModelsTable({ rows }: { rows: ModelRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No models.</p>;
	}
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-b text-left text-muted-foreground">
					<th className="py-1 font-medium">Model</th>
					<th className="font-medium">Name</th>
					<th className="font-medium">Context</th>
					<th className="font-medium">Tools</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr className="border-b/40" key={row.modelId}>
						<td className="py-1 font-mono">{row.modelId}</td>
						<td>{row.name}</td>
						<td className="text-muted-foreground">{row.contextLimit ?? "—"}</td>
						<td className="text-muted-foreground">
							{row.capabilities.toolCall ? "yes" : "no"}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function ModelsCard() {
	const [providerId, setProviderId] = useState("");
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId },
			enabled: providerId !== "",
		})
	);
	const view = useListView(models.data ?? [], { filter: matchModel });

	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Models</h2>
			<ListToolbar
				action={
					<ProviderPicker
						onChange={setProviderId}
						providers={catalog.data ?? []}
						value={providerId}
					/>
				}
				onSearch={view.setSearch}
				placeholder="Search models…"
				search={view.search}
			/>
			{providerId === "" ? (
				<p className="text-muted-foreground text-sm">
					Pick a provider to list its models.
				</p>
			) : (
				<>
					{models.isLoading ? (
						<Skeleton className="h-24 w-full" />
					) : (
						<ModelsTable rows={view.pageRows} />
					)}
					<Pagination
						onPage={view.setPage}
						page={view.page}
						pageCount={view.pageCount}
						total={view.total}
					/>
				</>
			)}
		</Card>
	);
}
```

- [ ] **Step 2: 构建 + 全仓库类型校验 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src/components/providers/models-card.tsx
git commit -m "refactor(admin): models card with search and pagination"
```

---

## Task 5: 端到端手动验证 + 运行说明

**Files:** Create `apps/admin/README.md`

- [ ] **Step 1: 端到端手动验证**

```bash
pnpm db:start
pnpm -F @better-agent/db db:push
CORS_ORIGIN=http://localhost:3002 pnpm -F server dev
# 另一个终端
pnpm -F @better-agent/admin dev
```
浏览 http://localhost:3002 → /providers，逐项确认（**按新规范**）：
1. 三张卡均为三段式：顶部【搜索 + 操作位】、中部表格、底部分页（X items / Prev / 页码 / Next）。
2. **Catalog**：Refresh → 列表填充；搜索框过滤；条目 >10 时分页可翻页。
3. **Credentials**：点 **Add credential** → 弹出 **modal**，填 provider/key/baseURL/enabled、Save → 弹窗关闭、列表出现该行（Key 显 `…末四位`）。
4. 点某行 **Edit** → modal 打开、provider 预选禁用、enabled/baseURL 预填、key 需重填；Save 覆盖。
5. 点某行 **Delete** → 弹出 **popover 确认**，Confirm 才删除、Cancel 不删。
6. **Models**：操作位选 provider → 列出模型；搜索 + 分页可用。
7. 任一请求失败 → 右上角 sonner toast 报错。

> CORS：服务端 `CORS_ORIGIN` 为单一 URL，联调须设为 `http://localhost:3002`。

- [ ] **Step 2: 写 `apps/admin/README.md`（运行说明 + 页面规范）**

```md
# @better-agent/admin

Admin UI (TanStack Start) for managing providers, agents, and sessions.

## Develop

```bash
# backend (allow the admin origin via CORS)
CORS_ORIGIN=http://localhost:3002 pnpm -F server dev
# admin (http://localhost:3002)
pnpm -F @better-agent/admin dev
```

Set `VITE_SERVER_URL` in `apps/admin/.env` (default `http://localhost:3000`).

## UI conventions

- **List pages** use three sections: search + action (top), table (middle), pagination (bottom) — see `src/components/list/`.
- **Add / Edit** open in a modal (`Dialog`).
- **Delete** uses a popover confirmation.

## Pages

- **Providers** — refresh the models.dev catalog, manage encrypted credentials (modal add/edit, popover-confirm delete), browse models per provider.
- **Agents** — _Plan 5b._
- **Sessions** — _Plan 5c._
```

- [ ] **Step 3: 提交**

```bash
pnpm fix
git add apps/admin/README.md
git commit -m "docs(admin): add run instructions and UI conventions"
```

---

## Self-Review（计划作者自检结论）

- **规范覆盖**：三段式（ListToolbar+表格+Pagination，Task 1 脚手架 + Task 2/3/4 套用）、增改 modal（Task 3 `CredentialDialog`）、删除 popover 确认（Task 3 `DeleteConfirm`）全覆盖；只读 Catalog/Models 按确认的口径保留搜索+分页、操作位放 Refresh / provider 选择器（Task 2/4）。
- **占位扫描**：无 TBD；每步含完整文件内容或精确命令+期望输出。
- **类型一致性**：`useListView`/`ListToolbar`/`Pagination`（Task 1）在 Task 2/3/4 一致复用；行类型 `ProviderCatalogRow`/`CredentialRow`/`ModelRow` 复用既有 `api-types.ts`；`orpc.providers.*` 调用与既有路由 I/O 一致；Dialog/Popover 用已加入的 `@better-agent/ui` 组件（commit f165f88）。
- **已知风险**：① `PopoverTrigger render={<Button .../>}>Delete</PopoverTrigger>` 的 `render` prop 模式已由仓库自身生成的 `dialog.tsx`（`DialogPrimitive.Close render={<Button variant="outline" />}`）证实可用；Credentials 的 Add 按钮不经 Trigger（直接 `setDialog` 控制 `open`），仅 Delete 用 `PopoverTrigger`。② `CredentialDialog` 用 `key` 重挂以重置初值；Edit 因仅存末四位需重填 key（MVP，符合 upsert 语义）。③ 客户端分页/搜索（列表已整页拉取，providers 路由无服务端分页），数据量小可接受。④ 联调需 `CORS_ORIGIN=http://localhost:3002`。⑤ 门禁用 `build`（生成 routeTree 并整体编译）；本计划不新增路由，routeTree 不变。
