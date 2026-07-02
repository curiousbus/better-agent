# Web Agent-Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/agents` route in `apps/web` so customers can list, create, edit, delete, and rotate tokens for their own agents — copied and adapted from the admin version.

**Architecture:** Copy the admin's multi-step wizard + card components into `apps/web/src/components/agents/`, swap provider queries to the web-safe `orpc.providers.available` / `orpc.providers.models` endpoints, remove the Composio field entirely, and import `BUILTIN_TOOLS` from the `@better-agent/agent` package. Share list utility components (DeleteConfirm, ListToolbar, Pagination, useListView) by copying them to `apps/web/src/components/list/`. Add a sidebar entry and a TanStack Router route file, then manually register the route in `routeTree.gen.ts`.

**Tech Stack:** React, TanStack Router (file-based, SPA mode), TanStack Query via oRPC, Sonner toasts, `@better-agent/ui` component library, Ultracite/Biome for lint/format.

## Global Constraints

- No `any` types — use explicit types everywhere
- Magic numbers: only -1, 0, 1 allowed inline — extract others as named constants
- File line limit: ≤300 lines per file
- Function/component/callback limit: ≤50 lines each — split into named sub-components
- Follow Ultracite code standards from `CLAUDE.md`
- Do NOT git commit — the controller will commit
- Do NOT modify backend files
- Run `pnpm dlx ultracite fix` + `pnpm -F web check-types` + eslint before finishing
- Write report to `/Users/john/better-agent/docs/superpowers/reports/phase1-web-agents-report.md`

---

## File Map

**New files to create:**

| File | Responsibility |
|------|---------------|
| `apps/web/src/components/list/use-list-view.ts` | Pagination + search state hook (copied from admin) |
| `apps/web/src/components/list/list-toolbar.tsx` | Search input + action slot (copied from admin) |
| `apps/web/src/components/list/pagination.tsx` | Prev/Next pagination controls (copied from admin) |
| `apps/web/src/components/list/delete-confirm.tsx` | Delete confirmation popover (copied from admin) |
| `apps/web/src/components/agents/agent-form.ts` | Form model, serialization helpers (copied verbatim from admin) |
| `apps/web/src/components/agents/builtin-tools-field.tsx` | Checkbox list for built-in tools — imports from `@better-agent/agent/tool/builtin-tools` |
| `apps/web/src/components/agents/agent-wizard-steps.tsx` | Identity/Model/Params/Tools wizard steps — Model step uses `available`+`models`, no Composio |
| `apps/web/src/components/agents/agent-wizard.tsx` | Multi-step dialog container (copied verbatim from admin) |
| `apps/web/src/components/agents/token-reveal-dialog.tsx` | One-time token reveal modal (copied from admin, description updated) |
| `apps/web/src/components/agents/agent-token-controls.tsx` | RegenerateToken popover (copied from admin, GenerateTokenState removed — not needed) |
| `apps/web/src/components/agents/agents-card.tsx` | List + CRUD + token wiring — no Link to detail route (web has no detail page) |
| `apps/web/src/routes/agents.index.tsx` | `/agents` route component |

**Modified files:**

| File | Change |
|------|--------|
| `apps/web/package.json` | Add `"@better-agent/agent": "workspace:*"` to dependencies |
| `apps/web/src/components/sidebar.tsx` | Add Agents nav item |
| `apps/web/src/routeTree.gen.ts` | Register `/agents/` route (TanStack Router auto-gen, manually patched) |

---

### Task 1: Add list utility components to web

The admin's list utilities (DeleteConfirm, ListToolbar, Pagination, useListView) live in `apps/admin/src/components/list/`. Web doesn't have them. Copy them unchanged.

**Files:**
- Create: `apps/web/src/components/list/use-list-view.ts`
- Create: `apps/web/src/components/list/list-toolbar.tsx`
- Create: `apps/web/src/components/list/pagination.tsx`
- Create: `apps/web/src/components/list/delete-confirm.tsx`

**Interfaces:**
- Produces: `ListView<T>` interface + `useListView` hook, `ListToolbar`, `Pagination`, `DeleteConfirm` components

- [ ] **Step 1: Create `apps/web/src/components/list/use-list-view.ts`**

```typescript
import { useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 10;

export interface ListView<T> {
  page: number;
  pageCount: number;
  pageRows: T[];
  search: string;
  setPage: (page: number) => void;
  setSearch: (value: string) => void;
  total: number;
}

export function useListView<T>(
  rows: T[],
  /** filter: pass a stable (module-scoped) predicate — it is a useMemo dependency. */
  options: { filter: (row: T, query: string) => boolean; pageSize?: number }
): ListView<T> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const [search, setSearchState] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () =>
      rows.filter((row) => options.filter(row, search.trim().toLowerCase())),
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

- [ ] **Step 2: Create `apps/web/src/components/list/list-toolbar.tsx`**

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

- [ ] **Step 3: Create `apps/web/src/components/list/pagination.tsx`**

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

- [ ] **Step 4: Create `apps/web/src/components/list/delete-confirm.tsx`**

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

- [ ] **Step 5: Verify the files exist**

```bash
ls /Users/john/better-agent/apps/web/src/components/list/
```
Expected: `delete-confirm.tsx  list-toolbar.tsx  pagination.tsx  use-list-view.ts`

---

### Task 2: Add `@better-agent/agent` dependency to web

The `BUILTIN_TOOLS` export lives in `@better-agent/agent/tool/builtin-tools`. Web's `package.json` does not currently list `@better-agent/agent` as a dependency.

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces: `@better-agent/agent/tool/builtin-tools` available in web's TypeScript resolution

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json`, inside `"dependencies"`, add after the `@better-agent/api` line:

```json
"@better-agent/agent": "workspace:*",
```

The result should look like:
```json
"dependencies": {
  "@dnd-kit/core": "6.3.1",
  "@dnd-kit/sortable": "10.0.0",
  "@dnd-kit/utilities": "3.2.2",
  "@better-agent/agent": "workspace:*",
  "@better-agent/api": "workspace:*",
  ...
}
```

- [ ] **Step 2: Install the dependency**

```bash
cd /Users/john/better-agent && pnpm install
```

Expected: `Done in ...` with no errors.

---

### Task 3: Create `agent-form.ts` (web copy)

Copy the admin's `agent-form.ts` verbatim — it is pure TypeScript with no admin-only imports. It imports `AgentRow` from `@/utils/api-types`, which already exists in web.

**Files:**
- Create: `apps/web/src/components/agents/agent-form.ts`

**Interfaces:**
- Consumes: `AgentRow` from `@/utils/api-types`
- Produces: `AgentForm`, `EMPTY_AGENT_FORM`, `WIZARD_STEPS`, `isStepValid`, `isLastStep`, `toAgentInput`, `agentRowToForm`

- [ ] **Step 1: Create the file**

```typescript
import type { AgentRow } from "@/utils/api-types";

export interface AgentForm {
  builtinTools: string[];
  composioAccountIds: string[];
  description: string;
  maxOutputTokens: string;
  modelId: string;
  name: string;
  providerId: string;
  systemPrompt: string;
  temperature: string;
  topP: string;
}

export const EMPTY_AGENT_FORM: AgentForm = {
  composioAccountIds: [],
  builtinTools: [],
  name: "",
  description: "",
  systemPrompt: "",
  providerId: "",
  modelId: "",
  temperature: "",
  topP: "",
  maxOutputTokens: "",
};

export const WIZARD_STEPS = ["Identity", "Model", "Params", "Tools"] as const;

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
    composioAccountIds: form.composioAccountIds,
    builtinTools: form.builtinTools,
    name: form.name,
    description: form.description,
    systemPrompt: form.systemPrompt,
    providerId: form.providerId,
    modelId: form.modelId,
    params: toParams(form),
  };
}

function numToStr(value: number | null | undefined): string {
  return value?.toString() ?? "";
}

export function agentRowToForm(row: AgentRow): AgentForm {
  return {
    composioAccountIds: row.composioAccountIds ?? [],
    builtinTools: row.builtinTools ?? [],
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    providerId: row.providerId,
    modelId: row.modelId,
    temperature: numToStr(row.params?.temperature),
    topP: numToStr(row.params?.topP),
    maxOutputTokens: numToStr(row.params?.maxOutputTokens),
  };
}
```

---

### Task 4: Create `builtin-tools-field.tsx` (web version — reads from package)

Unlike the admin version (which hardcodes the list), the web version imports `BUILTIN_TOOLS` from `@better-agent/agent/tool/builtin-tools`.

**Files:**
- Create: `apps/web/src/components/agents/builtin-tools-field.tsx`

**Interfaces:**
- Consumes: `BUILTIN_TOOLS` from `@better-agent/agent/tool/builtin-tools`
- Produces: `BuiltinToolsField` component

- [ ] **Step 1: Create the file**

```tsx
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { BUILTIN_TOOLS } from "@better-agent/agent/tool/builtin-tools";

export function BuiltinToolsField({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string, checked: boolean) =>
    onChange(
      checked ? [...selected, id] : selected.filter((value) => value !== id)
    );

  return (
    <div className="flex flex-col gap-2">
      {BUILTIN_TOOLS.map((tool) => (
        <Label className="flex items-start gap-2 font-normal" key={tool.id}>
          <Checkbox
            checked={selected.includes(tool.id)}
            onCheckedChange={(checked) => toggle(tool.id, checked === true)}
          />
          <span className="flex flex-col">
            <span>{tool.label}</span>
            <span className="text-muted-foreground text-xs">
              {tool.description}
            </span>
          </span>
        </Label>
      ))}
    </div>
  );
}
```

---

### Task 5: Create `agent-wizard-steps.tsx` (web version — no Composio, web provider endpoints)

**Key differences from admin:**
1. `ModelStep` uses `orpc.providers.available` (not `credentialsList`) and `orpc.providers.models` (not `modelsList`)
2. `ToolsStep` renders ONLY `BuiltinToolsField` — no `ComposioAccountsField`

**Files:**
- Create: `apps/web/src/components/agents/agent-wizard-steps.tsx`

**Interfaces:**
- Consumes: `AgentForm`, `WIZARD_STEPS` from `./agent-form`; `BuiltinToolsField` from `./builtin-tools-field`; `orpc` from `@/utils/orpc`
- Produces: `Stepper`, `IdentityStep`, `ModelStep`, `ParamsStep`, `ToolsStep`

- [ ] **Step 1: Create the file**

Note: `orpc.providers.available` has no input. `orpc.providers.models` takes `{ providerId: string }`.

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
import { cn } from "@better-agent/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";

import { orpc } from "@/utils/orpc";

import type { AgentForm } from "./agent-form";
import { WIZARD_STEPS } from "./agent-form";
import { BuiltinToolsField } from "./builtin-tools-field";

type SetForm = (patch: Partial<AgentForm>) => void;

function StepDot({
  index,
  step,
  label,
}: {
  index: number;
  step: number;
  label: string;
}) {
  const done = index < step;
  const active = index === step;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full border text-xs",
          active && "border-foreground bg-foreground text-background",
          done && "border-foreground bg-foreground/15 text-foreground",
          !(active || done) && "border-border text-muted-foreground"
        )}
      >
        {index + 1}
      </span>
      <span
        className={cn(
          "text-xs",
          active || done
            ? "font-medium text-foreground"
            : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {WIZARD_STEPS.map((label, index) => (
        <Fragment key={label}>
          {index > 0 ? (
            <div
              className={cn(
                "h-px flex-1",
                index <= step ? "bg-foreground" : "bg-border"
              )}
            />
          ) : null}
          <StepDot index={index} label={label} step={step} />
        </Fragment>
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
  // Web-safe endpoints: no secrets exposed
  const available = useQuery(orpc.providers.available.queryOptions());
  const providers = (available.data ?? []).map((row) => row.providerId);
  const models = useQuery(
    orpc.providers.models.queryOptions({
      input: { providerId: form.providerId },
      enabled: form.providerId !== "",
    })
  );
  if (providers.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No enabled providers. Contact your administrator to set one up.
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

export function ToolsStep({ form, set }: { form: AgentForm; set: SetForm }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-sm">Built-in tools</p>
        <BuiltinToolsField
          onChange={(ids) => set({ builtinTools: ids })}
          selected={form.builtinTools}
        />
      </div>
    </div>
  );
}
```

---

### Task 6: Create `agent-wizard.tsx` (web — identical to admin)

**Files:**
- Create: `apps/web/src/components/agents/agent-wizard.tsx`

**Interfaces:**
- Consumes: `AgentForm`, `EMPTY_AGENT_FORM`, `isLastStep`, `isStepValid` from `./agent-form`; all step components from `./agent-wizard-steps`
- Produces: `AgentWizard` component

- [ ] **Step 1: Create the file**

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
  ToolsStep,
} from "./agent-wizard-steps";

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const PARAMS_STEP = 2;
const TOOLS_STEP = 3;

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle>
        </DialogHeader>
        <Stepper step={step} />
        {/* Fixed height so the modal stays the same size across every step. */}
        <div className="flex min-h-80 flex-col">
          {step === IDENTITY_STEP ? (
            <IdentityStep form={form} set={set} />
          ) : null}
          {step === MODEL_STEP ? <ModelStep form={form} set={set} /> : null}
          {step === PARAMS_STEP ? <ParamsStep form={form} set={set} /> : null}
          {step === TOOLS_STEP ? <ToolsStep form={form} set={set} /> : null}
        </div>
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

Note: `MODEL_STEP`, `PARAMS_STEP`, `TOOLS_STEP` constants are used in the JSX conditionals — they must be defined even if Biome may warn they "shadow" step names. If Biome complains about unused `MODEL_STEP`/`PARAMS_STEP`/`TOOLS_STEP` (they ARE used), this is fine. If Biome says they're only used once (inline), just keep them — the admin has the same pattern.

---

### Task 7: Create `token-reveal-dialog.tsx` (web copy, updated description)

**Files:**
- Create: `apps/web/src/components/agents/token-reveal-dialog.tsx`

**Interfaces:**
- Produces: `TokenRevealDialog` component

- [ ] **Step 1: Create the file**

Update the description to be customer-facing (remove "admin" reference):

```tsx
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
            Use this token to connect an external client to your agent.
            Anyone with it can chat as this agent — regenerate to revoke the
            old one.
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
```

---

### Task 8: Create `agent-token-controls.tsx` (web copy, remove GenerateTokenState)

The web agents list doesn't have a detail page, so `GenerateTokenState` (used on the agent detail page) is not needed. Only copy `RegenerateToken`.

**Files:**
- Create: `apps/web/src/components/agents/agent-token-controls.tsx`

**Interfaces:**
- Produces: `RegenerateToken` component

- [ ] **Step 1: Create the file**

```tsx
import { Button } from "@better-agent/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

function useRotateToken(onRotated: (token: string) => void) {
  return useMutation(
    orpc.agents.rotateToken.mutationOptions({
      // The server persists the rotated token; just surface it for copy.
      onSuccess: (result) => onRotated(result.token),
      onError: (error) => toast.error(error.message),
    })
  );
}

export function RegenerateToken({
  agentId,
  onToken,
}: {
  agentId: string;
  onToken: (token: string) => void;
}) {
  const rotate = useRotateToken(onToken);
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Regenerate token"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <RotateCwIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle className="text-sm">
          Regenerate token? Any external client using the old token will stop
          working.
        </PopoverTitle>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)} size="xs" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={rotate.isPending}
            onClick={() => {
              setOpen(false);
              rotate.mutate({ id: agentId });
            }}
            size="xs"
          >
            Regenerate
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

### Task 9: Create `agents-card.tsx` (web version — no detail route Link)

**Key difference from admin:** Admin's `AgentRows` wraps agent name in `<Link to="/agents/$agentId">`. Web has no detail page — render the name as plain text.

**Files:**
- Create: `apps/web/src/components/agents/agents-card.tsx`

**Interfaces:**
- Consumes: all list utilities from `@/components/list/`; `AgentRow` from `@/utils/api-types`; wizard + token components from siblings
- Produces: `AgentsCard` component

- [ ] **Step 1: Create the file**

This is ~250 lines — split into: `TokenCell`, `AgentRows`, `AgentsTable`, `useAgentWizard`, `useAgentMutations`, `AgentsCard`.

```tsx
import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
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
import { type AgentForm, agentRowToForm, toAgentInput } from "./agent-form";
import { RegenerateToken } from "./agent-token-controls";
import { AgentWizard } from "./agent-wizard";
import { TokenRevealDialog } from "./token-reveal-dialog";

const TOKEN_PREVIEW_LEN = 14;

function matchAgent(row: AgentRow, query: string): boolean {
  return (
    row.name.toLowerCase().includes(query) ||
    row.providerId.toLowerCase().includes(query) ||
    row.modelId.toLowerCase().includes(query)
  );
}

function TokenCell({ agentId }: { agentId: string }) {
  const tokenQuery = useQuery(
    orpc.agents.getToken.queryOptions({ input: { id: agentId } })
  );
  const token = tokenQuery.data ?? null;
  if (!token) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {token.slice(0, TOKEN_PREVIEW_LEN)}…
      </code>
      <CopyAction label="Copy token" text={token} />
    </div>
  );
}

function AgentRows({
  rows,
  onEdit,
  onDelete,
  onTokenRotated,
}: {
  rows: AgentRow[];
  onEdit: (row: AgentRow) => void;
  onDelete: (id: string) => void;
  onTokenRotated: (token: string) => void;
}) {
  return (
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell className="font-medium">{row.name}</TableCell>
          <TableCell className="font-mono text-muted-foreground">
            {row.providerId}/{row.modelId}
          </TableCell>
          <TableCell>
            <TokenCell agentId={row.id} />
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button onClick={() => onEdit(row)} size="xs" variant="outline">
                Edit
              </Button>
              <RegenerateToken agentId={row.id} onToken={onTokenRotated} />
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
  onTokenRotated,
}: {
  view: ListView<AgentRow>;
  onEdit: (row: AgentRow) => void;
  onDelete: (id: string) => void;
  onTokenRotated: (token: string) => void;
}) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Token</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <AgentRows
          onDelete={onDelete}
          onEdit={onEdit}
          onTokenRotated={onTokenRotated}
          rows={view.pageRows}
        />
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
  const openAdd = () => setState({ open: true, id: null, initial: null });
  const openEdit = (row: AgentRow) =>
    setState({ open: true, id: row.id, initial: agentRowToForm(row) });
  const close = (open: boolean) => setState((s) => ({ ...s, open }));
  return { state, openAdd, openEdit, close };
}

function useAgentMutations(
  onSaved: () => void,
  onTokenMinted: (token: string) => void
) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
  const create = useMutation(
    orpc.agents.create.mutationOptions({
      onSuccess: (result) => {
        onTokenMinted(result.token);
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
  const submit = (editingId: string | null, form: AgentForm) => {
    const input = toAgentInput(form);
    if (editingId === null) {
      create.mutate(input);
    } else {
      update.mutate({ id: editingId, ...input });
    }
  };
  return { create, update, remove, submit };
}

export function AgentsCard() {
  const queryClient = useQueryClient();
  const agents = useQuery(orpc.agents.list.queryOptions());
  const view = useListView(agents.data ?? [], { filter: matchAgent });
  const { state, openAdd, openEdit, close } = useAgentWizard();
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const { create, update, remove, submit } = useAgentMutations(
    () => close(false),
    setRevealToken
  );
  const handleTokenRotated = (token: string) => {
    setRevealToken(token);
    queryClient.invalidateQueries({ queryKey: orpc.agents.getToken.key() });
  };
  return (
    <div className="flex flex-col gap-3">
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
        onTokenRotated={handleTokenRotated}
        view={view}
      />
      {state.open ? (
        <AgentWizard
          initial={state.initial}
          key={state.id ?? "new"}
          onOpenChange={close}
          onSubmit={(form) => submit(state.id, form)}
          open={state.open}
          pending={create.isPending || update.isPending}
        />
      ) : null}
      <TokenRevealDialog
        onClose={() => setRevealToken(null)}
        token={revealToken}
      />
    </div>
  );
}
```

---

### Task 10: Create the `/agents` route file

**Files:**
- Create: `apps/web/src/routes/agents.index.tsx`

**Interfaces:**
- Produces: TanStack Router route at `/agents/`

- [ ] **Step 1: Create the file**

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { AgentsCard } from "@/components/agents/agents-card";

export const Route = createFileRoute("/agents/")({
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 overflow-auto p-6">
      <AgentsCard />
    </div>
  );
}
```

---

### Task 11: Add Agents item to the sidebar

**Files:**
- Modify: `apps/web/src/components/sidebar.tsx`

- [ ] **Step 1: Add the Agents nav item**

`Bot` is already imported in `sidebar.tsx` (it's used for the brand icon). Add a new section after `Board`:

```tsx
const SECTIONS: readonly NavSection[] = [
  {
    kind: "item",
    item: { to: "/", label: "Home", icon: Home },
  },
  {
    kind: "item",
    item: { to: "/board", label: "Board", icon: LayoutDashboard },
  },
  {
    kind: "item",
    item: { to: "/agents", label: "Agents", icon: Bot },
  },
];
```

---

### Task 12: Register the route in `routeTree.gen.ts`

TanStack Router's file-based routing auto-generates `routeTree.gen.ts` at dev/build time. Since we're not running the dev server, manually patch it to include the new `/agents/` route. This makes `check-types` pass without running the router generator.

**Files:**
- Modify: `apps/web/src/routeTree.gen.ts`

- [ ] **Step 1: Add the import near the top (after existing route imports)**

After the `IndexRouteImport` import line, add:
```typescript
import { Route as AgentsIndexRouteImport } from './routes/agents.index'
```

- [ ] **Step 2: Add the route constant (after the existing `IndexRoute` constant)**

After the block for `IndexRoute`, add:
```typescript
const AgentsIndexRoute = AgentsIndexRouteImport.update({
  id: '/agents/',
  path: '/agents/',
  getParentRoute: () => rootRouteImport,
} as any)
```

- [ ] **Step 3: Add to `FileRoutesByFullPath`, `FileRoutesByTo`, `FileRoutesById`**

In `FileRoutesByFullPath`:
```typescript
'/agents/': typeof AgentsIndexRoute
```

In `FileRoutesByTo`:
```typescript
'/agents/': typeof AgentsIndexRoute
```

In `FileRoutesById`:
```typescript
'/agents/': typeof AgentsIndexRoute
```

- [ ] **Step 4: Update `FileRouteTypes`**

In `fileRoutesByFullPath` / `fullPaths`, add:
```typescript
| '/agents/'
```

In `fileRoutesByTo` / `to`, add:
```typescript
| '/agents/'
```

In `id`, add:
```typescript
| '/agents/'
```

- [ ] **Step 5: Add to `RootRouteChildren` interface and `rootRouteChildren` object**

In the `RootRouteChildren` interface:
```typescript
AgentsIndexRoute: typeof AgentsIndexRoute
```

In `rootRouteChildren`:
```typescript
AgentsIndexRoute: AgentsIndexRoute,
```

- [ ] **Step 6: Update `FileRoutesByPath` module augmentation**

Add:
```typescript
'/agents/': {
  id: '/agents/'
  path: '/agents/'
  fullPath: '/agents/'
  preLoaderRoute: typeof AgentsIndexRouteImport
  parentRoute: typeof rootRouteImport
}
```

---

### Task 13: Run checks and fix issues

- [ ] **Step 1: Run Ultracite fix on the new files**

```bash
cd /Users/john/better-agent && pnpm dlx ultracite fix apps/web/src/components/agents apps/web/src/components/list apps/web/src/routes/agents.index.tsx apps/web/src/components/sidebar.tsx
```

Review output. If files were modified, review the diffs to ensure no logic was changed.

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/john/better-agent && pnpm -F web check-types
```

Expected: zero errors. If errors, fix them:
- `AgentRow` shape mismatches → check `api-types.ts`
- Missing exports → check import paths
- Unused variables → remove them
- `orpc.providers.available` not found → double-check router export name in `packages/api/src/routers/providers.ts` and `packages/api/src/routers/index.ts`

- [ ] **Step 3: Run ESLint**

```bash
cd /Users/john/better-agent && npx eslint apps/web/src/components/agents apps/web/src/components/list apps/web/src/routes/agents.index.tsx apps/web/src/components/sidebar.tsx
```

Expected: 0 errors.

- [ ] **Step 4: Run web tests (if any)**

```bash
cd /Users/john/better-agent && pnpm -F web test
```

Expected: all pass (web tests are in `board/` subdirectories — nothing in agents yet, so no new test failures).

---

### Task 14: Write the report

- [ ] **Step 1: Create the reports directory**

```bash
mkdir -p /Users/john/better-agent/docs/superpowers/reports
```

- [ ] **Step 2: Write the report**

Create `/Users/john/better-agent/docs/superpowers/reports/phase1-web-agents-report.md` listing:
- Every file created/modified
- Exact check commands run and their output (pass/fail)
- Any files that hit the 300/50-line limits and how they were split
- Anything that could not be finished or uncertain
- Final status: DONE / DONE_WITH_CONCERNS / BLOCKED

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `/agents` route | Task 10 |
| List their agents | Task 9 (`AgentsCard` + `useListView`) |
| Create agent (wizard) | Task 5, 6 |
| Edit agent | Task 9 (`useAgentMutations.update`) |
| Delete agent | Task 9 (`useAgentMutations.remove` + `DeleteConfirm`) |
| View/rotate token | Tasks 7, 8 |
| Web-safe provider endpoints (`available`, `models`) | Task 5 (`ModelStep`) |
| Built-in tools from `@better-agent/agent` package | Tasks 2, 4 |
| No Composio field | Task 5 (ToolsStep has only BuiltinToolsField) |
| Sidebar "Agents" item with Bot icon | Task 11 |
| `AgentRow` type in web | Already exists in `api-types.ts` — no task needed |
| `composioAccountIds` stays `[]` always | Task 3 (EMPTY_AGENT_FORM + form keeps it as []) |
| ≤300 lines per file | `agents-card.tsx` ~250 lines ✓; `agent-wizard-steps.tsx` ~205 lines ✓ |
| ≤50 lines per function | All functions split into sub-components ✓ |
| List utility components | Task 1 |
| routeTree registration | Task 12 |
| Run checks and report | Tasks 13, 14 |

**Placeholder scan:** No "TBD", "TODO", or "implement later" in any step. All code is shown.

**Type consistency:**
- `AgentRow` used consistently from `@/utils/api-types` (already has it)
- `orpc.providers.available.queryOptions()` — no input; `orpc.providers.models.queryOptions({ input: { providerId } })` — matches provider router
- `ListView<T>` interface produced in Task 1, consumed in Task 9 (`view: ListView<AgentRow>`)
- `AgentForm` produced in Task 3, consumed in Tasks 4, 5, 6, 9

**One concern to flag in report:** `IDENTITY_STEP=0`, `MODEL_STEP=1`, `PARAMS_STEP=2`, `TOOLS_STEP=3` are defined and used in `agent-wizard.tsx` JSX. If Biome flags these as redundant (the values match their positions), they should be kept for readability — same as admin. Add `// biome-ignore lint/...` only if Biome errors on them, not proactively.
