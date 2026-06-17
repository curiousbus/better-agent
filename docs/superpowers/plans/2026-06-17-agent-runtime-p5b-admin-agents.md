# Plan 5b：admin Agents 页（多步向导 + CRUD）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin 的 **Agents 页**：三段式列表（搜索 + Add / 表格 / 分页）管理 agent，增改走**多步向导 modal**（Identity → Model → Params），删除走 popover 确认；provider 下拉只列「有 enabled 凭证」的 provider，model 依赖所选 provider 动态加载。

**Architecture:** 复用既有列表脚手架（`useListView`/`ListToolbar`/`Pagination`）+ shadcn 组件（`Dialog`/`Select`/`Table`/`Popover`/`Button`/`Input`/`Label`/`Textarea`，**全部 shadcn，无原生表单控件**）。向导是一个 `Dialog`，内部 step 状态在三步间切换；表单字段值用字符串持有、提交时解析。数据走既有 `agents` oRPC 路由（含服务端 provider→model 校验），provider 选项取 `providers.credentialsList`(enabled)，model 选项取 `providers.modelsList`。行类型从 `RouterClient<AppRouter>` 推断，不依赖 `packages/agent`。

**Tech Stack:** React 19 · TanStack Router/Query · `@orpc/tanstack-query` · `@better-agent/ui`(base-ui shadcn) · Tailwind v4。`Textarea` 已加入 ui（commit `eecbf80`）。

## Global Constraints

- 记忆 `admin-ui-conventions`：**只用 shadcn 组件**（禁原生 `<table>`/`<select>`/`<textarea>`；用 `Table`/`Select`/`Textarea`/`Badge` 等）；列表三段式；增改用 modal；删除用 popover 确认。
- 每个 commit 前 `pnpm fix`；apps 依赖区间镜像 `apps/web`；文件名 kebab-case；**函数/组件 ≤50 行、单文件 ≤300 行**（超限拆子组件/拆文件，逻辑不变）；禁 `any`/`console`；`key` 用稳定 id；表单控件配 `id`/`htmlFor` 或 `aria-label`（biome `noLabelWithoutControl`）；`verbatimModuleSyntax` → 仅类型导入用 `import type`。
- 数据经 `orpc`：`useQuery(orpc.X.queryOptions({ input? }))`、`useMutation(orpc.X.mutationOptions({ onSuccess, onError }))`、失效 `queryClient.invalidateQueries({ queryKey: orpc.X.key() })`、错误 `toast.error(error.message)`。
- 不 import `packages/agent`：行类型用 `@/utils/api-types`。
- **验证**：手动/浏览器 e2e；每个任务自动门禁 = `pnpm -F @better-agent/admin build`（已接入路由的任务）或 `check-types`（仅新增未接入组件的任务）；最终任务**实际渲染并截图**列表 + 向导每一步。
- **agents 路由契约**（来自 `packages/api/src/routers/agents.ts`）：`list()→AgentRow[]`；`get({id})`；`create(input)`；`update({id, ...input})`；`delete({id})→{ok}`。`input = { name, description, systemPrompt, providerId, modelId, params: { temperature, topP, maxOutputTokens } | null }`（均 `string.min(1)`，params 数值可空：temperature 0–2、topP 0–1、maxOutputTokens int>0）。create/update 服务端校验 provider 有 enabled 凭证 + model 在 cache，失败 `BAD_REQUEST`（前端 toast）。
- **范围**：仅 Agents 页。Sessions（流式对话）= Plan 5c。

---

## 文件结构

**Create:**
- `apps/admin/src/components/agents/agent-form.ts` — 表单类型 + 校验 + 解析（纯）
- `apps/admin/src/components/agents/agent-wizard-steps.tsx` — `Stepper`/`IdentityStep`/`ModelStep`/`ParamsStep`
- `apps/admin/src/components/agents/agent-wizard.tsx` — `AgentWizard`（Dialog + 步进 + footer）
- `apps/admin/src/components/list/delete-confirm.tsx` — 复用的 popover 删除确认
- `apps/admin/src/components/agents/agents-card.tsx` — 列表（表格 + 增改/删除接线）

**Modify:**
- `apps/admin/src/utils/api-types.ts` — 增 `AgentRow`
- `apps/admin/src/routes/agents.tsx` — 渲染 `AgentsCard`

---

## Task 1: 向导组件（表单类型/校验 + 三步 + Dialog 壳）

**Files:**
- Modify: `apps/admin/src/utils/api-types.ts`
- Create: `apps/admin/src/components/agents/agent-form.ts`, `agent-wizard-steps.tsx`, `agent-wizard.tsx`

**Interfaces:**
- Produces: `AgentRow`（api-types）；`AgentForm`/`EMPTY_AGENT_FORM`/`isStepValid`/`isLastStep`/`toAgentInput`/`agentRowToForm`（agent-form）；`Stepper`/`IdentityStep`/`ModelStep`/`ParamsStep`（steps）；`AgentWizard`（wizard）。Task 2 的列表消费 `AgentWizard`/`agentRowToForm`/`toAgentInput`/`EMPTY_AGENT_FORM`/`AgentRow`。

- [ ] **Step 1: 在 `api-types.ts` 增 `AgentRow`**

在文件末尾追加：
```ts
export type AgentRow = Awaited<
	ReturnType<Client["agents"]["list"]>
>[number];
```

- [ ] **Step 2: 写 `components/agents/agent-form.ts`**

```ts
import type { AgentRow } from "@/utils/api-types";

export interface AgentForm {
	name: string;
	description: string;
	systemPrompt: string;
	providerId: string;
	modelId: string;
	temperature: string;
	topP: string;
	maxOutputTokens: string;
}

export const EMPTY_AGENT_FORM: AgentForm = {
	name: "",
	description: "",
	systemPrompt: "",
	providerId: "",
	modelId: "",
	temperature: "",
	topP: "",
	maxOutputTokens: "",
};

export const WIZARD_STEPS = ["Identity", "Model", "Params"] as const;

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const LAST_STEP = WIZARD_STEPS.length - 1;

export function isStepValid(step: number, form: AgentForm): boolean {
	if (step === IDENTITY_STEP) {
		return (
			form.name.trim() !== "" &&
			form.description.trim() !== "" &&
			form.systemPrompt.trim() !== ""
		);
	}
	if (step === MODEL_STEP) {
		return form.providerId !== "" && form.modelId !== "";
	}
	return true;
}

export function isLastStep(step: number): boolean {
	return step === LAST_STEP;
}

function toNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function toParams(form: AgentForm) {
	const temperature = toNumber(form.temperature);
	const topP = toNumber(form.topP);
	const maxOutputTokens = toNumber(form.maxOutputTokens);
	if (temperature === null && topP === null && maxOutputTokens === null) {
		return null;
	}
	return { temperature, topP, maxOutputTokens };
}

export function toAgentInput(form: AgentForm) {
	return {
		name: form.name,
		description: form.description,
		systemPrompt: form.systemPrompt,
		providerId: form.providerId,
		modelId: form.modelId,
		params: toParams(form),
	};
}

export function agentRowToForm(row: AgentRow): AgentForm {
	return {
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		temperature: row.params?.temperature?.toString() ?? "",
		topP: row.params?.topP?.toString() ?? "",
		maxOutputTokens: row.params?.maxOutputTokens?.toString() ?? "",
	};
}
```

- [ ] **Step 3: 写 `components/agents/agent-wizard-steps.tsx`**

```tsx
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { orpc } from "@/utils/orpc";

import type { AgentForm } from "./agent-form";
import { WIZARD_STEPS } from "./agent-form";

type SetForm = (patch: Partial<AgentForm>) => void;

export function Stepper({ step }: { step: number }) {
	return (
		<div className="flex gap-3 text-sm">
			{WIZARD_STEPS.map((label, index) => (
				<span
					className={
						index === step
							? "font-medium text-foreground"
							: "text-muted-foreground"
					}
					key={label}
				>
					{index + 1}. {label}
				</span>
			))}
		</div>
	);
}

function Field({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

export function IdentityStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-name" label="Name">
				<Input
					id="agent-name"
					onChange={(event) => set({ name: event.target.value })}
					value={form.name}
				/>
			</Field>
			<Field id="agent-desc" label="Description">
				<Input
					id="agent-desc"
					onChange={(event) => set({ description: event.target.value })}
					value={form.description}
				/>
			</Field>
			<Field id="agent-prompt" label="System prompt">
				<Textarea
					id="agent-prompt"
					onChange={(event) => set({ systemPrompt: event.target.value })}
					rows={5}
					value={form.systemPrompt}
				/>
			</Field>
		</div>
	);
}

function WizardSelect({
	id,
	value,
	onChange,
	placeholder,
	options,
	disabled,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	options: string[];
	disabled?: boolean;
}) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger className="w-full" id={id}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option} value={option}>
						{option}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function ModelStep({ form, set }: { form: AgentForm; set: SetForm }) {
	const credentials = useQuery(orpc.providers.credentialsList.queryOptions());
	const providers = (credentials.data ?? [])
		.filter((row) => row.enabled)
		.map((row) => row.providerId);
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId: form.providerId },
			enabled: form.providerId !== "",
		})
	);
	if (providers.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No enabled credentials. Add one on the Providers page first.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-provider" label="Provider">
				<WizardSelect
					id="agent-provider"
					onChange={(value) => set({ providerId: value, modelId: "" })}
					options={providers}
					placeholder="Select a provider…"
					value={form.providerId}
				/>
			</Field>
			<Field id="agent-model" label="Model">
				<WizardSelect
					disabled={form.providerId === ""}
					id="agent-model"
					onChange={(value) => set({ modelId: value })}
					options={(models.data ?? []).map((model) => model.modelId)}
					placeholder="Select a model…"
					value={form.modelId}
				/>
			</Field>
		</div>
	);
}

export function ParamsStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-temp" label="Temperature (0–2, optional)">
				<Input
					id="agent-temp"
					inputMode="decimal"
					onChange={(event) => set({ temperature: event.target.value })}
					value={form.temperature}
				/>
			</Field>
			<Field id="agent-topp" label="Top P (0–1, optional)">
				<Input
					id="agent-topp"
					inputMode="decimal"
					onChange={(event) => set({ topP: event.target.value })}
					value={form.topP}
				/>
			</Field>
			<Field id="agent-maxout" label="Max output tokens (optional)">
				<Input
					id="agent-maxout"
					inputMode="numeric"
					onChange={(event) => set({ maxOutputTokens: event.target.value })}
					value={form.maxOutputTokens}
				/>
			</Field>
		</div>
	);
}
```

- [ ] **Step 4: 写 `components/agents/agent-wizard.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { useState } from "react";

import {
	type AgentForm,
	EMPTY_AGENT_FORM,
	isLastStep,
	isStepValid,
} from "./agent-form";
import {
	IdentityStep,
	ModelStep,
	ParamsStep,
	Stepper,
} from "./agent-wizard-steps";

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const PARAMS_STEP = 2;

function WizardFooter({
	step,
	canNext,
	pending,
	onCancel,
	onBack,
	onNext,
}: {
	step: number;
	canNext: boolean;
	pending: boolean;
	onCancel: () => void;
	onBack: () => void;
	onNext: () => void;
}) {
	const last = isLastStep(step);
	return (
		<div className="flex justify-between">
			<Button onClick={onCancel} size="sm" type="button" variant="outline">
				Cancel
			</Button>
			<div className="flex gap-2">
				{step > IDENTITY_STEP ? (
					<Button onClick={onBack} size="sm" type="button" variant="outline">
						Back
					</Button>
				) : null}
				<Button
					disabled={!canNext || (last && pending)}
					onClick={onNext}
					size="sm"
					type="button"
				>
					{last ? "Save" : "Next"}
				</Button>
			</div>
		</div>
	);
}

export function AgentWizard({
	open,
	onOpenChange,
	initial,
	onSubmit,
	pending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial: AgentForm | null;
	onSubmit: (form: AgentForm) => void;
	pending: boolean;
}) {
	const [step, setStep] = useState(IDENTITY_STEP);
	const [form, setForm] = useState<AgentForm>(initial ?? EMPTY_AGENT_FORM);
	const set = (patch: Partial<AgentForm>) =>
		setForm((current) => ({ ...current, ...patch }));
	const next = () =>
		isLastStep(step) ? onSubmit(form) : setStep((current) => current + 1);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle>
				</DialogHeader>
				<Stepper step={step} />
				{step === IDENTITY_STEP ? <IdentityStep form={form} set={set} /> : null}
				{step === MODEL_STEP ? <ModelStep form={form} set={set} /> : null}
				{step === PARAMS_STEP ? <ParamsStep form={form} set={set} /> : null}
				<WizardFooter
					canNext={isStepValid(step, form)}
					onBack={() => setStep((current) => current - 1)}
					onCancel={() => onOpenChange(false)}
					onNext={next}
					pending={pending}
					step={step}
				/>
			</DialogContent>
		</Dialog>
	);
}
```

> 说明：① `initial !== null` ⇒ Edit（标题「Edit agent」）；Add 传 `EMPTY_AGENT_FORM`。② 列表用 `key`（agentId 或 "new"）重挂向导以重置内部 step/form。③ Next 在 `isStepValid` 不满足时禁用；最后一步按钮变 Save、提交时 disabled。

- [ ] **Step 5: 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过（向导文件此时未被路由引用，靠 `tsc` 校验编译）。
```bash
pnpm fix
git add apps/admin/src/utils/api-types.ts apps/admin/src/components/agents
git commit -m "feat(admin): add agent wizard (identity/model/params steps)"
```

---

## Task 2: 复用删除确认 + Agents 列表页（接线向导）

**Files:**
- Create: `apps/admin/src/components/list/delete-confirm.tsx`, `apps/admin/src/components/agents/agents-card.tsx`
- Modify: `apps/admin/src/routes/agents.tsx`

**Interfaces:**
- Consumes: Task 1 的 `AgentWizard`/`agentRowToForm`/`toAgentInput`/`EMPTY_AGENT_FORM`/`AgentRow`/`AgentForm`；脚手架 `useListView`/`ListToolbar`/`Pagination`；shadcn `Table`/`Button`/`Card`；`orpc.agents.*`。
- Produces: `DeleteConfirm`（复用 popover 删除确认）；`AgentsCard`；`/agents` 路由渲染它。

- [ ] **Step 1: 写 `components/list/delete-confirm.tsx`（复用的 popover 删除确认）**

```tsx
import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useState } from "react";

export function DeleteConfirm({
	onConfirm,
	label = "Delete this item?",
}: {
	onConfirm: () => void;
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger render={<Button size="xs" variant="destructive" />}>
				Delete
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">{label}</PopoverTitle>
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
```

> 说明：credentials-card 有自带的等价 DeleteConfirm；本计划新增共享版供 agents 用、不改 credentials（后续可统一，属可选清理，非本计划范围）。

- [ ] **Step 2: 写 `components/agents/agents-card.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import {
	type AgentForm,
	agentRowToForm,
	EMPTY_AGENT_FORM,
	toAgentInput,
} from "./agent-form";
import { AgentWizard } from "./agent-wizard";

function matchAgent(row: AgentRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.providerId.toLowerCase().includes(query) ||
		row.modelId.toLowerCase().includes(query)
	);
}

function AgentRows({
	rows,
	onEdit,
	onDelete,
}: {
	rows: AgentRow[];
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<TableBody>
			{rows.map((row) => (
				<TableRow key={row.id}>
					<TableCell className="font-medium">{row.name}</TableCell>
					<TableCell className="font-mono text-muted-foreground">
						{row.providerId}/{row.modelId}
					</TableCell>
					<TableCell className="max-w-xs truncate text-muted-foreground">
						{row.description}
					</TableCell>
					<TableCell className="text-right">
						<div className="flex justify-end gap-2">
							<Button onClick={() => onEdit(row)} size="xs" variant="outline">
								Edit
							</Button>
							<DeleteConfirm
								label="Delete this agent?"
								onConfirm={() => onDelete(row.id)}
							/>
						</div>
					</TableCell>
				</TableRow>
			))}
		</TableBody>
	);
}

function AgentsTable({
	view,
	onEdit,
	onDelete,
}: {
	view: ListView<AgentRow>;
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Description</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<AgentRows onDelete={onDelete} onEdit={onEdit} rows={view.pageRows} />
			</Table>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</>
	);
}

function useAgentWizard() {
	const [state, setState] = useState<{
		open: boolean;
		id: string | null;
		initial: AgentForm | null;
	}>({ open: false, id: null, initial: null });
	const openAdd = () =>
		setState({ open: true, id: null, initial: EMPTY_AGENT_FORM });
	const openEdit = (row: AgentRow) =>
		setState({ open: true, id: row.id, initial: agentRowToForm(row) });
	const close = (open: boolean) => setState((s) => ({ ...s, open }));
	return { state, openAdd, openEdit, close };
}

function useAgentMutations(onSaved: () => void) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
	const create = useMutation(
		orpc.agents.create.mutationOptions({
			onSuccess: () => {
				toast.success("Agent created");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const update = useMutation(
		orpc.agents.update.mutationOptions({
			onSuccess: () => {
				toast.success("Agent updated");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.agents.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Agent deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return { create, update, remove };
}

export function AgentsCard() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const view = useListView(agents.data ?? [], { filter: matchAgent });
	const { state, openAdd, openEdit, close } = useAgentWizard();
	const { create, update, remove } = useAgentMutations(() => close(false));
	const handleSubmit = (form: AgentForm) => {
		const input = toAgentInput(form);
		if (state.id === null) {
			create.mutate(input);
		} else {
			update.mutate({ id: state.id, ...input });
		}
	};
	return (
		<Card className="flex flex-col gap-3 p-4">
			<ListToolbar
				action={
					<Button onClick={openAdd} size="sm">
						Add agent
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search agents…"
				search={view.search}
			/>
			<AgentsTable
				onDelete={(id) => remove.mutate({ id })}
				onEdit={openEdit}
				view={view}
			/>
			{state.open ? (
				<AgentWizard
					initial={state.initial}
					key={state.id ?? "new"}
					onOpenChange={close}
					onSubmit={handleSubmit}
					open={state.open}
					pending={create.isPending || update.isPending}
				/>
			) : null}
		</Card>
	);
}
```

- [ ] **Step 3: 改 `routes/agents.tsx` 渲染 `AgentsCard`**

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { AgentsCard } from "@/components/agents/agents-card";

export const Route = createFileRoute("/agents")({
	component: AgentsPage,
});

function AgentsPage() {
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-bold text-2xl">Agents</h1>
				<p className="text-muted-foreground text-sm">
					Configure agents with a provider, model, and system prompt.
				</p>
			</div>
			<AgentsCard />
		</div>
	);
}
```

- [ ] **Step 4: 构建 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功（routeTree 不变，`/agents` 路由已存在）。
Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src/components/list/delete-confirm.tsx apps/admin/src/components/agents/agents-card.tsx apps/admin/src/routes/agents.tsx
git commit -m "feat(admin): add agents list page with wizard create/edit and delete"
```

---

## Task 3: 端到端手动验证（渲染并截图）+ README

**Files:**
- Modify: `apps/admin/README.md`

- [ ] **Step 1: 起后端 + admin，渲染并逐项确认**

```bash
pnpm db:start
pnpm -F @better-agent/db db:push
CORS_ORIGIN=http://localhost:3001,http://localhost:3002 pnpm -F server dev
# 另一个终端
pnpm -F @better-agent/admin dev
```
前置：Providers 页先刷新 catalog + 配一个 enabled 凭证（向导 provider 下拉才有选项）。
浏览 http://localhost:3002/agents，逐项确认（**实际渲染/截图**，不只看 build）：
1. 列表三段式：搜索 + **Add agent** / 表格（Name·Model·Description·Actions，shadcn `Table`）/ 分页。
2. **Add agent** → 弹出向导 modal，**Stepper** 显示 1.Identity 2.Model 3.Params。
3. Step 1 填 name/description/system prompt；name 或 prompt 为空时 **Next 禁用**；填完 Next 进 Step 2。
4. Step 2：Provider 下拉只列「有 enabled 凭证」的 provider（无凭证则显示提示）；选 provider 后 Model 下拉可用并列出该 provider 模型；选完 model，Next 可用 → Step 3。
5. Step 3：可留空 params；点 **Save** → 列表出现新 agent（Model 列显示 `provider/model`）。
6. 点某行 **Edit** → 向导预填该 agent 全部字段（Edit 标题）；改 system prompt → Save 覆盖。
7. 点某行 **Delete** → popover 确认，Confirm 才删。
8. 校验失败路径：若选了无凭证 provider（不会发生，因下拉已过滤）或服务端拒绝 → 右上角 toast。

- [ ] **Step 2: 改 `apps/admin/README.md` 的 Pages 段，把 Agents 标为已实现**

把 `- **Agents** — _Plan 5b._` 改为：
```md
- **Agents** — list, create/edit via a multi-step wizard (identity → model → params), delete with confirm. Provider options come from enabled credentials.
```

- [ ] **Step 3: 提交**

```bash
pnpm fix
git add apps/admin/README.md
git commit -m "docs(admin): document agents page in README"
```

---

## Self-Review（计划作者自检结论）

- **设计覆盖**：覆盖 5b 设计全部 —— 列表三段式（Task 2 `AgentsCard` 用脚手架 + shadcn `Table`）、多步向导 modal（Task 1 `AgentWizard` 三步 + Stepper + Next 校验门控）、provider 下拉取 enabled 凭证 + model 依赖加载（Task 1 `ModelStep`）、Edit 全字段预填（`agentRowToForm`）、删除 popover 确认（Task 2 共享 `DeleteConfirm`）。Sessions 划归 5c。
- **占位扫描**：无 TBD；每步含完整文件内容或精确命令+期望输出。
- **类型一致性**：`AgentRow`（Task 1 api-types）在 `agent-form.ts`/`agents-card.tsx` 一致；`AgentForm`/`EMPTY_AGENT_FORM`/`toAgentInput`/`agentRowToForm`/`isStepValid`/`isLastStep`（agent-form）被 wizard 与 card 一致消费；`toAgentInput(form)` 形状与 `agents.create` 入参一致，`{ id, ...toAgentInput(form) }` 与 `agents.update` 入参一致；`orpc.agents.*` 调用与路由 I/O 一致；shadcn 组件全部来自 `@better-agent/ui`（含 Task 0 已加的 `Textarea`）。
- **已知风险**：① base-ui `Select` `value=""` 表示未选（placeholder 兜底）；`onValueChange` 首参收敛为 string（`typeof next === "string" ? next : ""`）。② 切 provider 时 `set({ providerId, modelId: "" })` 清空 model，避免跨 provider 脏 model。③ 向导用 `key`（id 或 "new"）重挂以重置 step/form；Edit 预填 step 从 0 开始。④ 文件可能逼近 50 行/300 行限制——steps 已抽 `Field`/`WizardSelect`，card 已抽 `AgentRows`/`AgentsTable`/`useAgentWizard`/`useAgentMutations`；若仍超限再拆。⑤ 共享 `DeleteConfirm` 与 credentials 自带版并存（不改 credentials，避免动已审代码）。⑥ 验证须先在 Providers 页配 enabled 凭证，否则向导无 provider 可选——属正确依赖，已在 Task 3 标注。
