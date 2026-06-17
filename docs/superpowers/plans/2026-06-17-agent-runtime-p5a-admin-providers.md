# Plan 5a：admin 后台脚手架 + Providers 管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `apps/admin`（对齐 `apps/web` 的 TanStack Start 技术栈），交付一个可用的左侧导航壳 + **Providers 管理页**：刷新 models.dev 目录、查看 provider 目录、增删改查 provider 凭证（密钥脱敏）、按 provider 浏览模型。

**Architecture:** `apps/admin` 镜像 `apps/web`（TanStack Start + React19 + tanstack-router 文件路由 + tanstack-query + oRPC client）。所有数据走既有 `providers` oRPC 路由，经 `@orpc/tanstack-query` 的 `orpc` 工具以 `useQuery`/`useMutation` 调用，复用 `@better-agent/ui`（shadcn/base-ui）组件 + tailwind。页面用「已有 UI 组件 + tailwind 原生元素」（原生 `<table>`/`<select>`、内联表单、`Checkbox`、`<span>` 徽章）搭建——**不新增 shadcn 组件**，避免对未生成的 base-ui 组件 API 的猜测。设计见本文件，对齐 spec 第 2 节架构图与第 16 节阶段表「admin 管理后台」。

**Tech Stack:** TanStack Start(`@tanstack/react-start`) + `@tanstack/react-router` + `@tanstack/react-query` · `@orpc/tanstack-query`(1.14.x) · React 19 · Tailwind v4 · `@better-agent/ui`(base-ui shadcn) · lucide-react · sonner。

## Global Constraints

- 每个 commit 前先跑 `pnpm fix`（biome）再提交。
- **依赖版本镜像 `apps/web` 的 `package.json` 原样**（含 `^` 区间）——apps 不套用后端包「禁 `^`」的精确锁版约定，与同级 `apps/web` 保持一致即可。
- 文件名 kebab-case；**函数/组件 ≤50 行、圈复杂度 ≤10**（仓库 ESLint `max-lines-per-function: 50` 在 pre-commit 拦截——组件超限就拆子组件，逻辑不变）；禁 `any`/`console`；魔法数字抽常量；JSX 用语义元素 + `key` 用稳定 id（非数组下标）。
- 数据获取统一经 `orpc`（`@orpc/tanstack-query`）：查询 `useQuery(orpc.X.queryOptions({ input? }))`，变更 `useMutation(orpc.X.mutationOptions({ onSuccess, onError }))`，失效用 `queryClient.invalidateQueries({ queryKey: orpc.X.key() })`。错误统一 `toast.error(error.message)`（sonner），加载用 `Skeleton`。
- **验证方式**：手动/浏览器 e2e（无单测基建）。每个任务的自动门禁 = `pnpm -F @better-agent/admin build` 成功（vite build 会编译 TS 并由 tanstackStart 插件生成 `routeTree.gen.ts`）；最终任务做完整手动 e2e。
- **不依赖 `packages/agent`**：页面用到的行类型从 `RouterClient<AppRouter>` 推断（见 Task 2 的 `api-types.ts`）。
- **范围**：仅 admin 壳 + Providers 页。Agent 向导 = Plan 5b；会话流式对话 = Plan 5c（本计划建占位路由 `/agents`、`/sessions`，5b/5c 填充）。鉴权不做（spec 延后）。

---

## 文件结构

**Create（Task 1 脚手架）:**
- `apps/admin/package.json`、`apps/admin/vite.config.ts`、`apps/admin/tsconfig.json`、`apps/admin/nitro.config.ts`、`apps/admin/components.json`、`apps/admin/.env`
- `apps/admin/src/index.css`、`apps/admin/src/router.tsx`、`apps/admin/src/utils/orpc.ts`
- `apps/admin/src/components/app-sidebar.tsx`
- `apps/admin/src/routes/__root.tsx`、`routes/index.tsx`、`routes/providers.tsx`(占位)、`routes/agents.tsx`、`routes/sessions.tsx`
- `apps/admin/src/routeTree.gen.ts`（由 build 生成、提交）

**Create（Task 2–4）:**
- `apps/admin/src/utils/api-types.ts`（推断行类型）
- `apps/admin/src/components/providers/catalog-card.tsx`（Task 2）
- `apps/admin/src/components/providers/credentials-card.tsx`（Task 3）
- `apps/admin/src/components/providers/models-card.tsx`（Task 4）

**Modify:** `apps/admin/src/routes/providers.tsx`（Task 2/3/4 组合卡片）

---

## Task 1: 脚手架 `apps/admin` + 导航壳 + 占位路由

**Files:** 见上「Task 1 脚手架」。
**Interfaces:**
- Produces: 可启动的 admin 应用；`@/utils/orpc` 导出 `orpc`/`createQueryClient`；`/providers`、`/agents`、`/sessions` 路由存在（providers 为占位）；`/` 重定向到 `/providers`。Task 2–4 在此基础上填充 providers 页。

- [ ] **Step 1: 写配置文件**

`apps/admin/package.json`（把 `apps/web/package.json` 的 deps/devDeps **原样照抄**，仅改 `name`，并加 `check-types` 脚本）：
```json
{
  "name": "@better-agent/admin",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "serve": "vite preview",
    "dev": "vite dev",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@better-agent/api": "workspace:*",
    "@better-agent/env": "workspace:*",
    "@better-agent/ui": "workspace:*",
    "@orpc/client": "catalog:",
    "@orpc/server": "catalog:",
    "@orpc/tanstack-query": "^1.13.14",
    "@tailwindcss/vite": "^4.2.2",
    "@tanstack/react-query": "^5.99.0",
    "@tanstack/react-router": "^1.168.22",
    "@tanstack/react-router-ssr-query": "^1.166.11",
    "@tanstack/react-start": "^1.167.41",
    "dotenv": "catalog:",
    "evlog": "catalog:",
    "lucide-react": "^1.8.0",
    "next-themes": "catalog:",
    "nitro": "^3.0.260429-beta",
    "react": "catalog:",
    "react-dom": "catalog:",
    "sonner": "^2.0.7",
    "tailwindcss": "^4.2.2",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@better-agent/config": "workspace:*",
    "@tanstack/react-query-devtools": "^5.91.1",
    "@tanstack/react-router-devtools": "^1.166.13",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "^6.0.1",
    "typescript": "catalog:",
    "vite": "^8.0.8"
  }
}
```

`apps/admin/vite.config.ts`（端口 **3002**）：
```ts
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3002,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
});
```

`apps/admin/tsconfig.json`（照抄 `apps/web/tsconfig.json` 原样）：
```json
{
  "include": ["**/*.ts", "**/*.tsx"],
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "paths": {
      "@/*": ["./src/*"],
      "@better-agent/ui/*": ["../../packages/ui/src/*"]
    }
  }
}
```

`apps/admin/nitro.config.ts`：
```ts
import evlog from "evlog/nitro/v3";
import { defineConfig } from "nitro";

export default defineConfig({
	experimental: {
		asyncContext: true,
	},
	modules: [
		evlog({
			env: { service: "better-agent-admin" },
		}),
	],
});
```

`apps/admin/components.json`（照抄 `apps/web/components.json` 原样——`style: base-lyra`，css 指向 `../../packages/ui/src/styles/globals.css`，aliases `components: @/components`、`ui: @better-agent/ui/components`、`utils: @better-agent/ui/lib/utils`）。

`apps/admin/.env`：
```
VITE_SERVER_URL=http://localhost:3000
```

`apps/admin/src/index.css`：
```css
@import "@better-agent/ui/globals.css";
```

- [ ] **Step 2: 写 `src/utils/orpc.ts`（照抄 `apps/web/src/utils/orpc.ts` 原样）**

```ts
import type { AppRouter } from "@better-agent/api/routers/index";
import { env } from "@better-agent/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const STALE_TIME_MS = 60_000;

export function createQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				toast.error(`Error: ${error.message}`, {
					action: {
						label: "retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
		defaultOptions: { queries: { staleTime: STALE_TIME_MS } },
	});
}

const link = new RPCLink({
	url: `${env.VITE_SERVER_URL}/rpc`,
});

const getORPCClient = () => createORPCClient(link) as RouterClient<AppRouter>;

export const client: RouterClient<AppRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
```

- [ ] **Step 3: 写 `src/router.tsx`（照抄 `apps/web/src/router.tsx` 原样）**

```ts
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";
import { createQueryClient, orpc } from "./utils/orpc";

export const getRouter = () => {
	const queryClient = createQueryClient();

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		context: { orpc, queryClient },
		defaultNotFoundComponent: () => <div>Not Found</div>,
	});

	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
```

- [ ] **Step 4: 写导航 `src/components/app-sidebar.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { Boxes, MessagesSquare, Settings2 } from "lucide-react";

const NAV = [
	{ to: "/providers", label: "Providers", icon: Settings2 },
	{ to: "/agents", label: "Agents", icon: Boxes },
	{ to: "/sessions", label: "Sessions", icon: MessagesSquare },
] as const;

export function AppSidebar() {
	return (
		<aside className="w-56 shrink-0 border-r bg-card p-3">
			<div className="mb-4 px-2 font-semibold text-sm">better-agent admin</div>
			<nav className="flex flex-col gap-1">
				{NAV.map((item) => (
					<Link
						activeProps={{ className: "bg-accent text-accent-foreground" }}
						className="flex items-center gap-2 rounded-none px-2 py-1.5 text-muted-foreground text-sm hover:bg-accent/50"
						key={item.to}
						to={item.to}
					>
						<item.icon className="size-4" />
						{item.label}
					</Link>
				))}
			</nav>
		</aside>
	);
}
```

- [ ] **Step 5: 写 `src/routes/__root.tsx`（根文档 + 侧栏布局）**

```tsx
import { Toaster } from "@better-agent/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import type { orpc } from "@/utils/orpc";

import appCss from "../index.css?url";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "better-agent admin" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	component: RootDocument,
});

function RootDocument() {
	return (
		<html className="dark" lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<div className="flex min-h-screen">
					<AppSidebar />
					<main className="flex-1 p-6">
						<Outlet />
					</main>
				</div>
				<Toaster richColors />
				<Scripts />
			</body>
		</html>
	);
}
```

- [ ] **Step 6: 写路由 `index.tsx` / `providers.tsx`(占位) / `agents.tsx` / `sessions.tsx`**

`src/routes/index.tsx`（重定向到 /providers）：
```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/providers" });
	},
});
```

`src/routes/providers.tsx`（本任务占位，Task 2 起填充）：
```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

function ProvidersPage() {
	return <h1 className="font-bold text-2xl">Providers</h1>;
}
```

`src/routes/agents.tsx`：
```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents")({
	component: () => (
		<div>
			<h1 className="font-bold text-2xl">Agents</h1>
			<p className="mt-2 text-muted-foreground text-sm">Coming soon.</p>
		</div>
	),
});
```

`src/routes/sessions.tsx`（同 agents，标题与文案改为 Sessions）：
```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sessions")({
	component: () => (
		<div>
			<h1 className="font-bold text-2xl">Sessions</h1>
			<p className="mt-2 text-muted-foreground text-sm">Coming soon.</p>
		</div>
	),
});
```

- [ ] **Step 7: 安装 + 构建（生成 routeTree）+ 提交**

Run: `pnpm install`
Expected: 识别 `@better-agent/admin`，`pnpm-lock.yaml` 更新。
Run: `pnpm -F @better-agent/admin build`
Expected: 构建成功；生成 `apps/admin/src/routeTree.gen.ts`（含 `/`、`/providers`、`/agents`、`/sessions`）。
```bash
pnpm fix
git add apps/admin pnpm-lock.yaml
git commit -m "feat(admin): scaffold admin app with sidebar and placeholder routes"
```

> 手动确认（可选，本任务非必须）：`CORS_ORIGIN=http://localhost:3002 pnpm -F server dev` 起后端，另起 `pnpm -F @better-agent/admin dev`，浏览 http://localhost:3002 → 重定向到 /providers，侧栏三项可点。

---

## Task 2: Provider 目录卡片（列表 + 刷新）

**Files:**
- Create: `apps/admin/src/utils/api-types.ts`, `apps/admin/src/components/providers/catalog-card.tsx`
- Modify: `apps/admin/src/routes/providers.tsx`

**Interfaces:**
- Consumes: `orpc.providers.catalogList`（无入参 → `ProviderCatalogRow[]`）、`orpc.providers.catalogRefresh`（无入参变更）。
- Produces: `<CatalogCard />`；`api-types.ts` 导出 `ProviderCatalogRow`/`CredentialRow`/`ModelRow`（供 Task 3/4 复用）。

- [ ] **Step 1: 写 `src/utils/api-types.ts`（从 RouterClient 推断行类型，不依赖 packages/agent）**

```ts
import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type ProviderCatalogRow = Awaited<
	ReturnType<Client["providers"]["catalogList"]>
>[number];

export type CredentialRow = Awaited<
	ReturnType<Client["providers"]["credentialsList"]>
>[number];

export type ModelRow = Awaited<
	ReturnType<Client["providers"]["modelsList"]>
>[number];
```

- [ ] **Step 2: 写 `src/components/providers/catalog-card.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function CatalogTable({
	rows,
	loading,
}: {
	rows: ProviderCatalogRow[];
	loading: boolean;
}) {
	if (loading) {
		return <Skeleton className="h-24 w-full" />;
	}
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No providers yet. Click “Refresh catalog”.
			</p>
		);
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
		<Card className="p-4">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="font-semibold text-lg">Provider catalog</h2>
				<Button
					disabled={refresh.isPending}
					onClick={() => refresh.mutate(undefined)}
					size="sm"
				>
					{refresh.isPending ? "Refreshing…" : "Refresh catalog"}
				</Button>
			</div>
			<CatalogTable loading={catalog.isLoading} rows={catalog.data ?? []} />
		</Card>
	);
}
```

> 说明：`catalogRefresh` 无入参，`mutate(undefined)` 满足 `void` 变量类型；失效用 `orpc.providers.catalogList.key()`。

- [ ] **Step 3: 把 CatalogCard 接入 `src/routes/providers.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { CatalogCard } from "@/components/providers/catalog-card";

export const Route = createFileRoute("/providers")({
	component: ProvidersPage,
});

function ProvidersPage() {
	return (
		<div className="flex flex-col gap-6">
			<h1 className="font-bold text-2xl">Providers</h1>
			<CatalogCard />
		</div>
	);
}
```

- [ ] **Step 4: 构建 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功（routeTree 不变，无新路由）。
```bash
pnpm fix
git add apps/admin/src
git commit -m "feat(admin): add provider catalog card with refresh"
```

---

## Task 3: Provider 凭证卡片（列表 + 增改 + 删除）

**Files:**
- Create: `apps/admin/src/components/providers/credentials-card.tsx`
- Modify: `apps/admin/src/routes/providers.tsx`

**Interfaces:**
- Consumes: `orpc.providers.credentialsList`（无入参 → `CredentialRow[]`，含 `providerId/baseURL/enabled/last4`）、`orpc.providers.credentialsUpsert`（入参 `{ providerId, apiKey, baseURL: string|null, enabled }`）、`orpc.providers.credentialsDelete`（入参 `{ providerId }`）、`orpc.providers.catalogList`（填 provider 下拉）。
- Produces: `<CredentialsCard />`。

- [ ] **Step 1: 写 `src/components/providers/credentials-card.tsx`**

> 拆三个子组件保持每个函数 ≤50 行：`CredentialForm`（内联增改表单）、`CredentialRows`（表格行）、`CredentialsCard`（组合 + 查询/变更）。

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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

function CredentialForm({
	providers,
	onSubmit,
	pending,
}: {
	providers: ProviderCatalogRow[];
	onSubmit: (form: FormState) => void;
	pending: boolean;
}) {
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	return (
		<form
			className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(form);
				setForm(EMPTY_FORM);
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-provider">Provider</Label>
				<select
					className="h-8 border bg-transparent px-2 text-sm"
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
					onChange={(event) =>
						setForm({ ...form, baseURL: event.target.value })
					}
					value={form.baseURL}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm">
				<Checkbox
					checked={form.enabled}
					onCheckedChange={(checked) =>
						setForm({ ...form, enabled: checked === true })
					}
				/>
				Enabled
			</label>
			<Button disabled={pending} size="sm" type="submit">
				Save
			</Button>
		</form>
	);
}

function CredentialRows({
	rows,
	onDelete,
}: {
	rows: CredentialRow[];
	onDelete: (providerId: string) => void;
}) {
	return (
		<tbody>
			{rows.map((row) => (
				<tr className="border-b/40" key={row.providerId}>
					<td className="py-1 font-mono">{row.providerId}</td>
					<td className="font-mono text-muted-foreground">…{row.last4}</td>
					<td className="text-muted-foreground">{row.baseURL ?? "—"}</td>
					<td>
						<span
							className={
								row.enabled ? "text-green-500" : "text-muted-foreground"
							}
						>
							{row.enabled ? "enabled" : "disabled"}
						</span>
					</td>
					<td className="text-right">
						<Button
							onClick={() => onDelete(row.providerId)}
							size="xs"
							variant="destructive"
						>
							Delete
						</Button>
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
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.providers.credentialsList.key(),
		});
	const upsert = useMutation(
		orpc.providers.credentialsUpsert.mutationOptions({
			onSuccess: () => {
				toast.success("Credential saved");
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
		<Card className="flex flex-col gap-4 p-4">
			<h2 className="font-semibold text-lg">Credentials</h2>
			<CredentialForm
				onSubmit={(form) =>
					upsert.mutate({
						providerId: form.providerId,
						apiKey: form.apiKey,
						baseURL: form.baseURL.trim() === "" ? null : form.baseURL.trim(),
						enabled: form.enabled,
					})
				}
				pending={upsert.isPending}
				providers={catalog.data ?? []}
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
					rows={credentials.data ?? []}
				/>
			</table>
		</Card>
	);
}
```

- [ ] **Step 2: 把 CredentialsCard 接入 `providers.tsx`**

在 `ProvidersPage` 的 `<CatalogCard />` 下方加 `<CredentialsCard />`，并加 import：
```tsx
import { CredentialsCard } from "@/components/providers/credentials-card";
```
```tsx
			<CatalogCard />
			<CredentialsCard />
```

- [ ] **Step 3: 构建 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
```bash
pnpm fix
git add apps/admin/src
git commit -m "feat(admin): add provider credentials CRUD card"
```

---

## Task 4: 模型浏览卡片（按 provider 列模型）

**Files:**
- Create: `apps/admin/src/components/providers/models-card.tsx`
- Modify: `apps/admin/src/routes/providers.tsx`

**Interfaces:**
- Consumes: `orpc.providers.catalogList`（provider 下拉）、`orpc.providers.modelsList`（入参 `{ providerId }` → `ModelRow[]`，含 `modelId/name/contextLimit/capabilities`）。
- Produces: `<ModelsCard />`。

- [ ] **Step 1: 写 `src/components/providers/models-card.tsx`**

```tsx
import { Card } from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { ModelRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function ModelsTable({
	rows,
	loading,
}: {
	rows: ModelRow[];
	loading: boolean;
}) {
	if (loading) {
		return <Skeleton className="h-24 w-full" />;
	}
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No models for this provider.
			</p>
		);
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

export function ModelsCard() {
	const [providerId, setProviderId] = useState("");
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId },
			enabled: providerId !== "",
		})
	);

	return (
		<Card className="flex flex-col gap-3 p-4">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-lg">Models</h2>
				<ProviderPicker
					onChange={setProviderId}
					providers={catalog.data ?? []}
					value={providerId}
				/>
			</div>
			{providerId === "" ? (
				<p className="text-muted-foreground text-sm">
					Pick a provider to list its models.
				</p>
			) : (
				<ModelsTable
					loading={models.isLoading}
					rows={models.data ?? []}
				/>
			)}
		</Card>
	);
}
```

> 说明：`modelsList` 仅在选了 provider 时启用（`queryOptions({ input, enabled })`）。

- [ ] **Step 2: 接入 `providers.tsx`**

加 import 与 `<ModelsCard />`（置于 `<CredentialsCard />` 下方）：
```tsx
import { ModelsCard } from "@/components/providers/models-card";
```
```tsx
			<CredentialsCard />
			<ModelsCard />
```

- [ ] **Step 3: 构建 + 全仓库类型校验 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src
git commit -m "feat(admin): add models browser card per provider"
```

---

## Task 5: 端到端手动验证 + 运行说明

**Files:**
- Create: `apps/admin/README.md`

- [ ] **Step 1: 端到端手动验证**

起后端（允许 admin 源跨域）与 admin：
```bash
pnpm db:start
pnpm -F @better-agent/db db:push
CORS_ORIGIN=http://localhost:3002 pnpm -F server dev
# 另一个终端
pnpm -F @better-agent/admin dev
```
浏览 http://localhost:3002，逐项确认：
1. `/` 自动跳到 `/providers`；侧栏 Providers/Agents/Sessions 可切换（Agents/Sessions 显示 “Coming soon”）。
2. **Refresh catalog** → 目录表格被 models.dev 数据填充（出现 anthropic/openai/… 行）。
3. **Credentials**：选一个 provider、填 API key（占位串即可）、勾 Enabled、Save → 列表出现该行，Key 显示 `…末四位`、Status `enabled`。
4. 删除该凭证 → 行消失。
5. **Models**：在 Models 卡选一个 provider → 列出该 provider 的模型（modelId/name/context/tools）。
6. 任一请求失败 → 右上角 sonner toast 报错（可断开后端验证）。

> CORS：服务端 `CORS_ORIGIN` 为单一 URL（`z.url()`），手动联调时须设为 admin 源 `http://localhost:3002`，否则浏览器拦截 admin 的 `/rpc` 请求。

- [ ] **Step 2: 写 `apps/admin/README.md`（运行说明）**

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

## Pages

- **Providers** — refresh the models.dev catalog, manage encrypted provider credentials, browse models per provider.
- **Agents** — _Plan 5b._
- **Sessions** — _Plan 5c._
```

- [ ] **Step 3: 提交**

```bash
pnpm fix
git add apps/admin/README.md
git commit -m "docs(admin): add run instructions for the admin app"
```

---

## Self-Review（计划作者自检结论）

- **设计覆盖**：覆盖 5a 设计的全部 —— admin 脚手架（Task 1，镜像 web 技术栈 + 侧栏 + 占位 `/agents`/`/sessions` 供 5b/5c）、Providers 页三卡（目录+刷新 Task 2、凭证 CRUD Task 3、模型浏览 Task 4），手动 e2e + 运行说明（Task 5）。Agent 向导/会话对话/鉴权按 Global Constraints 显式划出，非遗漏。
- **占位扫描**：无 TBD；每步含完整文件内容或精确命令+期望输出。唯一刻意的「占位」是 Task 1 的 `/agents`/`/sessions` 路由文案 “Coming soon”，属设计内的 5b/5c 占位，非计划缺口。
- **类型一致性**：`api-types.ts`（Task 2）的 `ProviderCatalogRow`/`CredentialRow`/`ModelRow` 在 Task 2/3/4 卡片一致复用；卡片对 `orpc.providers.*` 的调用与既有 `providers` 路由 I/O 一致（`catalogList`/`catalogRefresh` 无入参；`credentialsUpsert({providerId,apiKey,baseURL:string|null,enabled})`；`credentialsDelete({providerId})`；`modelsList({providerId})`）；`providers.tsx` 在 Task 2/3/4 逐步组合 `CatalogCard`/`CredentialsCard`/`ModelsCard`，名称一致。
- **已知风险**：① TanStack Start 应用类型校验依赖 `routeTree.gen.ts`，故门禁用 `build`（会生成它）而非裸 `tsc`；Task 1 提交生成物，后续任务不新增路由、routeTree 不变。② base-ui `Checkbox` 的 `onCheckedChange(checked)` 入参在不同版本可能是 `boolean` 或带事件；用 `checked === true` 收敛为 `boolean`，若签名不符按该组件实际签名微调。③ `mutate(undefined)` 用于无入参的 `catalogRefresh`（`void` 变量类型）；若 `@orpc/tanstack-query` 推断要求无参，改 `mutate()`。④ 联调需 `CORS_ORIGIN=http://localhost:3002`（单一源），已在 Task 5 标注。⑤ apps 依赖用 `^` 区间镜像 `apps/web`，与后端包「禁 `^`」约定不同，已在 Global Constraints 说明。⑥ `credentialsUpsert` 是 upsert，「编辑」=对同一 providerId 重新 Save 覆盖（无独立编辑态），符合 MVP。
