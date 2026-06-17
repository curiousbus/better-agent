# Plan 5c：admin Sessions 流式对话页实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin 的 **Sessions 对话页**：用 session 选择器（含「新建 session」选 agent 的 modal）切换会话，渲染会话历史（user/assistant 气泡，含 reasoning 块），底部输入框发消息——经 oRPC event iterator **实时流式**追加 assistant 文本，流式中 Send 变 **Stop**（abort）。

**Architecture:** 单会话 + 选择器布局。核心是 `useChat(sessionId)` hook：`useQuery(listMessages)` 取服务端历史，本地 `draft` 状态持有进行中的 user/streaming-assistant；`send()` 调 `client.sessions.prompt(input, { signal })` 拿到 `RunEvent` 异步迭代器、`for await` 累积 `text-delta`/`reasoning-delta`，`done`/`error` 收尾后 `invalidate(listMessages)`（拿服务端持久态）再清 draft；`stop()` 用 `AbortController` 中断。表现组件全用 shadcn（`Select`/`Dialog`/`Textarea`/`Card`/`Badge`/`Button`）。行类型从 `RouterClient<AppRouter>` 推断，不依赖 `packages/agent`。设计见本文件。

**Tech Stack:** React 19 · TanStack Router/Query · `@orpc/client`（`client.sessions.prompt` 流式 + `{ signal }`）+ `@orpc/tanstack-query` · `@better-agent/ui`(shadcn) · Tailwind v4。

## Global Constraints

- 记忆 `admin-ui-conventions`：**只用 shadcn 组件**（禁原生表单控件）；新建走 modal；列表三段式（本页 session 选择器非表格列表，对话区是聊天视图——三段式不强加于对话区，但「新建 session」用 modal）。
- 每个 commit 前 `pnpm fix`；apps 依赖镜像 `apps/web`；文件名 kebab-case；**函数/组件 ≤50 行、单文件 ≤300 行**（超限拆）；禁 `any`/`console`；`key` 用稳定 id；表单控件配 `id`/`htmlFor` 或 `aria-label`；`verbatimModuleSyntax` → 仅类型导入用 `import type`。
- 数据：查询用 `orpc`（`useQuery(orpc.X.queryOptions({ input? }))`）、变更用 `orpc` mutation、失效 `queryClient.invalidateQueries({ queryKey: ... })`、错误 `toast.error`；**流式用裸 `client`**（`client.sessions.prompt(input, { signal })`，`@/utils/orpc` 已导出 `client`）。
- 不 import `packages/agent`：类型用 `@/utils/api-types` 推断。
- **验证**：手动/浏览器 e2e；门禁 = `pnpm -F @better-agent/admin build`（接入路由的任务）或 `check-types`（仅组件的任务）；最终任务**实际渲染并截图**对话页。**注意**：真实 token 流式需有效 provider key；沙箱用占位 key 时 `prompt` 走 `error` 事件——可验证布局/建会话/错误气泡，真实流式由用户用有效 key 自行确认。
- **sessions 契约**（`packages/api/src/routers/sessions.ts`）：`create({agentId})→Session`（agent 不存在→BAD_REQUEST）；`list()→Session[]`；`listMessages({sessionId})→MessageWithParts[]`；`run`（非流）；`prompt({sessionId,text})→AsyncIterable<RunEvent>`（流式）。`RunEvent = message-start{messageId} | text-delta{delta} | reasoning-delta{delta} | step-finish | done{usage,finishReason} | error{message}`。
- **范围**：仅 Sessions 对话页。工具/权限/压缩等运行时高级特性不涉及（后端阶段）。

---

## 文件结构

**Create:**
- `apps/admin/src/components/sessions/use-chat.ts` — `ChatMessage`/`toChatMessage`/`useChat`（流式核心）
- `apps/admin/src/components/sessions/message-bubble.tsx` — 单条消息气泡
- `apps/admin/src/components/sessions/composer.tsx` — 输入框 + Send/Stop
- `apps/admin/src/components/sessions/session-picker.tsx` — session 选择器
- `apps/admin/src/components/sessions/new-session-dialog.tsx` — 新建会话 modal（选 agent）

**Modify:**
- `apps/admin/src/utils/api-types.ts` — 增 `SessionRow`、`SessionMessageRow`
- `apps/admin/src/routes/sessions.tsx` — 组装对话页

---

## Task 1: `useChat` 流式 hook + 行类型

**Files:**
- Modify: `apps/admin/src/utils/api-types.ts`
- Create: `apps/admin/src/components/sessions/use-chat.ts`

**Interfaces:**
- Produces: `SessionRow`/`SessionMessageRow`（api-types）；`ChatMessage`（`{ id, role, text, reasoning, status }`）、`useChat(sessionId) → { messages, streaming, send, stop }`。Task 2/3 消费。

- [ ] **Step 1: 在 `api-types.ts` 增 `SessionRow` / `SessionMessageRow`**

文件末尾追加：
```ts
export type SessionRow = Awaited<
	ReturnType<Client["sessions"]["list"]>
>[number];

export type SessionMessageRow = Awaited<
	ReturnType<Client["sessions"]["listMessages"]>
>[number];
```

- [ ] **Step 2: 写 `components/sessions/use-chat.ts`**

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { SessionMessageRow } from "@/utils/api-types";
import { client, orpc } from "@/utils/orpc";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	text: string;
	reasoning: string;
	status: "complete" | "streaming" | "error";
}

function partStatus(status: SessionMessageRow["message"]["status"]) {
	if (status === "complete") {
		return "complete" as const;
	}
	if (status === "error") {
		return "error" as const;
	}
	return "streaming" as const;
}

function toChatMessage(entry: SessionMessageRow): ChatMessage {
	let text = "";
	let reasoning = "";
	for (const part of entry.parts) {
		if (part.type === "text") {
			text += part.content.text;
		} else if (part.type === "reasoning") {
			reasoning += part.content.text;
		}
	}
	return {
		id: entry.message.id,
		role: entry.message.role,
		text,
		reasoning,
		status: partStatus(entry.message.status),
	};
}

export function useChat(sessionId: string) {
	const queryClient = useQueryClient();
	const history = useQuery(
		orpc.sessions.listMessages.queryOptions({
			input: { sessionId },
			enabled: sessionId !== "",
		})
	);
	const [draft, setDraft] = useState<ChatMessage[]>([]);
	const [streaming, setStreaming] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const messages: ChatMessage[] = [
		...(history.data ?? []).map(toChatMessage),
		...draft,
	];

	const send = async (text: string) => {
		if (sessionId === "" || streaming) {
			return;
		}
		const controller = new AbortController();
		abortRef.current = controller;
		setStreaming(true);
		const user: ChatMessage = {
			id: "draft-user",
			role: "user",
			text,
			reasoning: "",
			status: "complete",
		};
		const assistant: ChatMessage = {
			id: "draft-assistant",
			role: "assistant",
			text: "",
			reasoning: "",
			status: "streaming",
		};
		setDraft([user, assistant]);
		try {
			const iterator = await client.sessions.prompt(
				{ sessionId, text },
				{ signal: controller.signal }
			);
			for await (const event of iterator) {
				if (event.type === "text-delta") {
					assistant.text += event.delta;
				} else if (event.type === "reasoning-delta") {
					assistant.reasoning += event.delta;
				} else if (event.type === "error") {
					assistant.status = "error";
				}
				setDraft([user, { ...assistant }]);
			}
		} catch {
			assistant.status = "error";
			setDraft([user, { ...assistant }]);
		} finally {
			setStreaming(false);
			abortRef.current = null;
			await queryClient.invalidateQueries({
				queryKey: orpc.sessions.listMessages.key({ input: { sessionId } }),
			});
			setDraft([]);
		}
	};

	const stop = () => {
		abortRef.current?.abort();
	};

	return { messages, streaming, send, stop };
}
```

> 说明：① 渲染 = 服务端历史 + 本地 draft；流式中 draft 持有 user + streaming-assistant，每个事件 `setDraft([user, {...assistant}])` 触发重渲染。② `finally` 先 `await invalidate(listMessages)`（等服务端持久态刷回）再清 draft，避免最后一轮闪烁。③ `stop()` abort，迭代器随之结束、进 `finally`。④ 失效 key 用 `.key({ input: { sessionId } })`；若该签名不符，回退 `.queryKey({ input: { sessionId } })` 或无参 `.key()`（全量失效），保持 listMessages 刷新即可。

- [ ] **Step 3: 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过（hook 未被路由引用，靠 tsc 校验）。
```bash
pnpm fix
git add apps/admin/src/utils/api-types.ts apps/admin/src/components/sessions/use-chat.ts
git commit -m "feat(admin): add useChat hook for streaming session prompts"
```

---

## Task 2: 消息气泡 + 输入框组件

**Files:**
- Create: `apps/admin/src/components/sessions/message-bubble.tsx`, `apps/admin/src/components/sessions/composer.tsx`

**Interfaces:**
- Consumes: Task 1 的 `ChatMessage`；shadcn `Card`/`Badge`/`Textarea`/`Button`；`cn`（`@better-agent/ui/lib/utils`）。
- Produces: `<MessageBubble message />`；`<Composer disabled streaming onSend onStop />`。

- [ ] **Step 1: 写 `components/sessions/message-bubble.tsx`**

```tsx
import { Badge } from "@better-agent/ui/components/badge";
import { Card } from "@better-agent/ui/components/card";
import { cn } from "@better-agent/ui/lib/utils";

import type { ChatMessage } from "./use-chat";

export function MessageBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const streamingEmpty = message.status === "streaming" && message.text === "";
	return (
		<div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
			<Card
				className={cn(
					"max-w-[80%] gap-2 p-3",
					isUser ? "bg-primary text-primary-foreground" : "bg-card"
				)}
			>
				{message.reasoning === "" ? null : (
					<p className="whitespace-pre-wrap text-muted-foreground text-xs italic">
						{message.reasoning}
					</p>
				)}
				<p className="whitespace-pre-wrap text-sm">
					{streamingEmpty ? "…" : message.text}
				</p>
				{message.status === "error" ? (
					<Badge variant="destructive">error</Badge>
				) : null}
			</Card>
		</div>
	);
}
```

- [ ] **Step 2: 写 `components/sessions/composer.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useState } from "react";

export function Composer({
	disabled,
	streaming,
	onSend,
	onStop,
}: {
	disabled: boolean;
	streaming: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
}) {
	const [text, setText] = useState("");
	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "") {
			return;
		}
		onSend(trimmed);
		setText("");
	};
	return (
		<div className="flex items-end gap-2">
			<Textarea
				aria-label="Message"
				className="min-h-10 flex-1"
				disabled={disabled || streaming}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					}
				}}
				placeholder="Type a message… (Enter to send)"
				rows={2}
				value={text}
			/>
			{streaming ? (
				<Button onClick={onStop} size="sm" variant="destructive">
					Stop
				</Button>
			) : (
				<Button disabled={disabled} onClick={submit} size="sm">
					Send
				</Button>
			)}
		</div>
	);
}
```

- [ ] **Step 3: 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src/components/sessions/message-bubble.tsx apps/admin/src/components/sessions/composer.tsx
git commit -m "feat(admin): add chat message bubble and composer components"
```

---

## Task 3: session 选择器 + 新建会话 modal + 对话页组装

**Files:**
- Create: `apps/admin/src/components/sessions/session-picker.tsx`, `apps/admin/src/components/sessions/new-session-dialog.tsx`
- Modify: `apps/admin/src/routes/sessions.tsx`

**Interfaces:**
- Consumes: Task 1 `useChat`、Task 2 `MessageBubble`/`Composer`；`orpc.sessions.list`/`orpc.sessions.create`/`orpc.agents.list`；`SessionRow`；shadcn `Select`/`Dialog`/`Button`。
- Produces: `/sessions` 路由渲染完整对话页。

- [ ] **Step 1: 写 `components/sessions/session-picker.tsx`**

```tsx
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

import type { SessionRow } from "@/utils/api-types";

function sessionLabel(session: SessionRow): string {
	return session.title ?? `Session ${session.id.slice(0, 8)}`;
}

export function SessionPicker({
	sessions,
	value,
	onChange,
}: {
	sessions: SessionRow[];
	value: string;
	onChange: (sessionId: string) => void;
}) {
	return (
		<Select
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger aria-label="Session" className="w-72">
				<SelectValue placeholder="Select a session…" />
			</SelectTrigger>
			<SelectContent>
				{sessions.map((session) => (
					<SelectItem key={session.id} value={session.id}>
						{sessionLabel(session)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
```

- [ ] **Step 2: 写 `components/sessions/new-session-dialog.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function NewSessionDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (sessionId: string) => void;
}) {
	const queryClient = useQueryClient();
	const agents = useQuery(orpc.agents.list.queryOptions());
	const [agentId, setAgentId] = useState("");
	const create = useMutation(
		orpc.sessions.create.mutationOptions({
			onSuccess: (session) => {
				toast.success("Session created");
				queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
				onCreated(session.id);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New session</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<Label htmlFor="session-agent">Agent</Label>
						<Select
							onValueChange={(next) =>
								setAgentId(typeof next === "string" ? next : "")
							}
							value={agentId}
						>
							<SelectTrigger className="w-full" id="session-agent">
								<SelectValue placeholder="Select an agent…" />
							</SelectTrigger>
							<SelectContent>
								{(agents.data ?? []).map((agent) => (
									<SelectItem key={agent.id} value={agent.id}>
										{agent.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex justify-end gap-2">
						<Button
							onClick={() => onOpenChange(false)}
							size="sm"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={agentId === "" || create.isPending}
							onClick={() => create.mutate({ agentId })}
							size="sm"
						>
							Create
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 3: 写 `routes/sessions.tsx`（组装）**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Composer } from "@/components/sessions/composer";
import { MessageBubble } from "@/components/sessions/message-bubble";
import { NewSessionDialog } from "@/components/sessions/new-session-dialog";
import { SessionPicker } from "@/components/sessions/session-picker";
import { useChat } from "@/components/sessions/use-chat";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/sessions")({
	component: SessionsPage,
});

function Conversation({ sessionId }: { sessionId: string }) {
	const { messages, streaming, send, stop } = useChat(sessionId);
	return (
		<Card className="flex h-[70vh] flex-col gap-3 p-4">
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto">
				{messages.length === 0 ? (
					<p className="text-muted-foreground text-sm">No messages yet.</p>
				) : (
					messages.map((message) => (
						<MessageBubble key={message.id} message={message} />
					))
				)}
			</div>
			<Composer
				disabled={false}
				onSend={send}
				onStop={stop}
				streaming={streaming}
			/>
		</Card>
	);
}

function SessionsPage() {
	const sessions = useQuery(orpc.sessions.list.queryOptions());
	const [sessionId, setSessionId] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);
	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-bold text-2xl">Sessions</h1>
				<p className="text-muted-foreground text-sm">
					Chat with a configured agent. Pick a session or start a new one.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<SessionPicker
					onChange={setSessionId}
					sessions={sessions.data ?? []}
					value={sessionId}
				/>
				<Button onClick={() => setDialogOpen(true)} size="sm">
					New session
				</Button>
			</div>
			{sessionId === "" ? (
				<p className="text-muted-foreground text-sm">
					Select or create a session to start chatting.
				</p>
			) : (
				<Conversation key={sessionId} sessionId={sessionId} />
			)}
			{dialogOpen ? (
				<NewSessionDialog
					onCreated={setSessionId}
					onOpenChange={setDialogOpen}
					open={dialogOpen}
				/>
			) : null}
		</div>
	);
}
```

> 说明：`Conversation` 用 `key={sessionId}` 重挂以换会话时重置 chat 状态；`NewSessionDialog` 的 `onCreated` 直接把新 sessionId 选中。

- [ ] **Step 4: 构建 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功（`/sessions` 路由已存在，routeTree 不变）。
Run: `pnpm -F @better-agent/admin check-types`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src/components/sessions/session-picker.tsx apps/admin/src/components/sessions/new-session-dialog.tsx apps/admin/src/routes/sessions.tsx
git commit -m "feat(admin): assemble sessions chat page with picker and new-session modal"
```

---

## Task 4: 端到端手动验证（渲染并截图）+ README

**Files:**
- Modify: `apps/admin/README.md`

- [ ] **Step 1: 起后端 + admin，渲染并逐项确认**

```bash
pnpm db:start
pnpm -F @better-agent/db db:push
CORS_ORIGIN=http://localhost:3001,http://localhost:3002 pnpm -F server dev
pnpm -F @better-agent/admin dev
```
前置：Providers 页配 enabled 凭证、Agents 页建一个 agent。
浏览 http://localhost:3002/sessions，**实际渲染/截图**确认：
1. 页面：标题 + session 选择器 + **New session** 按钮；未选会话时显示「Select or create a session」。
2. **New session** → modal 选 agent → Create → 新 session 被选中，对话区出现（空历史「No messages yet.」）。
3. 输入框打字、Enter 发送 → 立刻出现 user 气泡 + streaming assistant 气泡（「…」）；**有有效 key 时** assistant 文本实时逐字追加，reasoning 模型还会显示 reasoning 块；流式中按钮变 **Stop**，点 Stop 中断。
4. **占位 key 时**：发送后 assistant 气泡显示 `error` 徽章（运行时 LLM 调用失败走 error 事件）——**这验证了流式传输管线通畅**（事件经 oRPC HTTP event iterator 到达前端）。
5. 切换 session 选择器 → 对话区换成该会话历史。
6. 刷新页面 → 历史从 `listMessages` 持久加载。

> 真实 token 流式需有效 provider key；占位 key 下验证布局/建会话/错误气泡/传输通畅即可，真实输出由用户用有效 key 确认。

- [ ] **Step 2: 改 `apps/admin/README.md` 的 Pages 段**

把 `- **Sessions** — _Plan 5c._` 改为：
```md
- **Sessions** — chat with a configured agent: pick/create a session (modal selects the agent), send messages, watch the assistant reply stream live (with reasoning), Stop to abort. History persists via listMessages.
```

- [ ] **Step 3: 提交**

```bash
pnpm fix
git add apps/admin/README.md
git commit -m "docs(admin): document sessions chat page in README"
```

---

## Self-Review（计划作者自检结论）

- **设计覆盖**：覆盖 5c 设计全部 —— session 选择器 + 新建会话 modal（Task 3）、对话历史渲染（Task 2 `MessageBubble` + reasoning 块 + error 徽章）、`useChat` 流式核心（Task 1：`client.sessions.prompt(input,{signal})` 迭代器、text/reasoning-delta 累积、done/error 收尾 + invalidate + 清 draft）、Send/Stop（Task 2 `Composer` + `useChat.stop()`）。spec §16「会话流式对话」满足。
- **占位扫描**：无 TBD；每步含完整文件或精确命令+期望输出。
- **类型一致性**：`SessionRow`/`SessionMessageRow`（Task 1 api-types）在 hook/picker 一致；`ChatMessage`（hook）被 `MessageBubble` 消费；`useChat` 返回 `{ messages, streaming, send, stop }` 被路由 `Conversation` 一致使用；`orpc.sessions.*`/`orpc.agents.list`/`client.sessions.prompt` 与路由 I/O 一致；shadcn 组件全来自 `@better-agent/ui`，无需新增组件。
- **已知风险**：① 流式经 oRPC HTTP event iterator —— RPCHandler(server)+RPCLink(client) 支持，`client.sessions.prompt(input,{signal})` 返回异步迭代器；若传输异常会在渲染时暴露（Task 4 验证）。② `listMessages.key({ input })` 失效 key 签名——不符则回退 `.queryKey({input})` 或无参 `.key()`。③ 占位 key 下 `prompt` 走 error 事件（真实输出需有效 key），已在 Task 4 注明。④ draft 用静态 id（"draft-user"/"draft-assistant"）；流式中禁止二次 send（`if streaming return`），无冲突；`finally` 先 await invalidate 再清 draft，避免末轮闪烁。⑤ `Conversation`/`NewSessionDialog` 用条件挂载 + `key` 重置状态。⑥ base-ui `Select` `value=""` = 未选（placeholder 兜底），`onValueChange` 收敛为 string。
