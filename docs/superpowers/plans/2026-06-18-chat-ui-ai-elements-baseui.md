# Chat UI（ai-elements 基于 Base UI 重写)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 admin 聊天界面升级为 ai-elements 风格 —— 在 `@better-agent/ui` 里**基于 Base UI**(不是 Radix)实现 ai-elements 的核心聊天组件(对话区/消息气泡/Markdown 渲染+代码高亮/思考折叠/输入框/Loader/复制),再把聊天页换成它们。

**Architecture:** 新组件放 `@better-agent/ui/components/`(shadcn-only,底层用 `@base-ui/react`),admin 聊天页消费。**不动后端**:沿用既有 `use-chat` hook(`messages`/`streaming`/`send`/`stop`)与 `ChatMessage { id, role, text, reasoning, status }`,只把渲染换好看。Markdown 用 `react-markdown` + `remark-gfm`,代码块用 `shiki` 高亮 + 复制。自动滚动用小自定义 hook(原生滚动容器,非 Radix)。

**Tech Stack:** React 19 · `@base-ui/react`(Collapsible) · `react-markdown`@10 + `remark-gfm`@4 · `shiki`@4 · Tailwind v4 · lucide-react · CVA/cn。

## Global Constraints

- 记忆 `admin-ui-conventions`:**只用 shadcn 组件**(Base UI 底层),禁原生表单控件 —— 本计划新增的就是这些组件本身。
- 每个 commit 前 `pnpm fix`;装包用 `pnpm add -E`(精确版本);`@better-agent/ui` 加新依赖装在该包下。
- 文件 kebab-case;**函数/组件 ≤50 行、单文件 ≤300 行**(超限拆子组件,逻辑不变);禁 `any`/`console`;`key` 用稳定 id;`verbatimModuleSyntax` → 仅类型导入用 `import type`;表单控件配 `aria-label`/`htmlFor`。
- `target="_blank"` 链接加 `rel="noopener noreferrer"`;shiki 输出用 `dangerouslySetInnerHTML` 渲染(已高亮的安全 HTML,加 `// biome-ignore lint/security/noDangerouslySetInnerHtml` 说明)。
- 不动后端、不动 `use-chat.ts`、不动 DB。`ChatMessage` 形状不变。
- **验证**:每个组件任务门禁 = `pnpm -F @better-agent/ui check-types`;接线任务 = `pnpm -F @better-agent/admin build`;最终任务**实际渲染并截图**(起 server+admin,在 agent 详情页聊天),核对 Markdown/代码高亮/思考折叠/输入框/复制/自动滚动。不创建测试数据(用一次 prompt 验证会产生消息,验证时用占位 provider 的 error 流即可,不需要真实 key)。
- **范围**:仅文字+reasoning 渲染的 UI 美化。图片/附件 = 后续子系统 2(PromptInput 预留左侧 tools 槽,本计划不填);语音 = 子系统 3;Sources/Suggestions/Tool 等组件不做。

---

## 文件结构

**Create(`@better-agent/ui/components/`):**
- `code-block.tsx` — shiki 高亮代码块 + 复制按钮
- `response.tsx` — `Response`:Markdown 渲染(react-markdown + remark-gfm,代码→CodeBlock)
- `loader.tsx` — `Loader`:加载/思考动画
- `conversation.tsx` — `Conversation`/`ConversationContent`/`ConversationScrollButton` + `useStickToBottom`
- `message.tsx` — `Message`/`MessageContent`/`MessageAvatar`
- `actions.tsx` — `Actions`/`Action`(含复制)
- `reasoning.tsx` — `Reasoning`/`ReasoningTrigger`/`ReasoningContent`(Base UI Collapsible)
- `prompt-input.tsx` — `PromptInput`/`PromptInputTextarea`/`PromptInputToolbar`/`PromptInputTools`/`PromptInputSubmit`

**Modify:**
- `packages/ui/package.json` — 加 `react-markdown`/`remark-gfm`/`shiki`
- `apps/admin/src/components/sessions/conversation.tsx` — 换用新组件
- **Delete:** `apps/admin/src/components/sessions/message-bubble.tsx`、`composer.tsx`

---

## Task 1: 依赖 + 代码块(shiki)+ Response(Markdown)

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/components/code-block.tsx`, `packages/ui/src/components/response.tsx`

**Interfaces:**
- Produces: `<CodeBlock code lang />`;`<Response>{markdown}</Response>`。Task 4 聊天页用 `Response` 渲染 assistant 文本。

- [ ] **Step 1: 加依赖**

Run:
```bash
pnpm -F @better-agent/ui add -E react-markdown@10.1.0 remark-gfm@4.0.1 shiki@4.2.0
```
Expected: 三个包写入 `packages/ui/package.json` 的 dependencies,`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写 `code-block.tsx`**

```tsx
import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

const COPIED_RESET_MS = 1500;

function useHighlighted(code: string, lang: string): string | null {
	const [html, setHtml] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		codeToHtml(code, {
			lang: lang || "text",
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		})
			.then((result) => {
				if (active) {
					setHtml(result);
				}
			})
			.catch(() => {
				if (active) {
					setHtml(null);
				}
			});
		return () => {
			active = false;
		};
	}, [code, lang]);
	return html;
}

function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			aria-label="Copy code"
			className="absolute top-2 right-2 rounded-none border bg-background/70 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
			onClick={() => {
				navigator.clipboard.writeText(code);
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_RESET_MS);
			}}
			type="button"
		>
			{copied ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CopyIcon className="size-3.5" />
			)}
		</button>
	);
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const html = useHighlighted(code, lang);
	return (
		<div className="group relative my-2">
			<CopyButton code={code} />
			{html ? (
				<div
					className={cn(
						"overflow-x-auto rounded-none border text-sm [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-3",
						"[&_code]:font-mono"
					)}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki 输出的是已转义的高亮 HTML
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="overflow-x-auto rounded-none border bg-muted p-3 font-mono text-sm">
					<code>{code}</code>
				</pre>
			)}
		</div>
	);
}
```

> 说明:`defaultColor: false` 让 shiki 用 CSS 变量产出 light/dark 双主题,配合站点的 `dark` class 自动切换;高亮前先用纯 `<pre>` 兜底(流式时代码逐步到达也能显示)。

- [ ] **Step 3: 写 `response.tsx`**

```tsx
import { cn } from "@better-agent/ui/lib/utils";
import type { ComponentProps } from "react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@better-agent/ui/components/code-block";

const LANG_RE = /language-(\w+)/;

function CodeRenderer({ className, children }: ComponentProps<"code">) {
	const match = LANG_RE.exec(className ?? "");
	const text = String(children ?? "").replace(/\n$/, "");
	if (match) {
		return <CodeBlock code={text} lang={match[1] ?? "text"} />;
	}
	return (
		<code className="rounded-none bg-muted px-1 py-0.5 font-mono text-[0.85em]">
			{children}
		</code>
	);
}

export const Response = memo(function Response({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"prose-sm max-w-none break-words text-sm leading-relaxed",
				"[&_a]:text-primary [&_a]:underline [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold",
				"[&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_ul]:list-disc [&_ul]:pl-5",
				"[&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
				className
			)}
		>
			<ReactMarkdown
				components={{
					code: CodeRenderer,
					a: ({ children: c, href }) => (
						<a href={href} rel="noopener noreferrer" target="_blank">
							{c}
						</a>
					),
				}}
				remarkPlugins={[remarkGfm]}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
});
```

- [ ] **Step 4: 校验 + 提交**

Run: `pnpm -F @better-agent/ui check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/ui/package.json packages/ui/src/components/code-block.tsx packages/ui/src/components/response.tsx pnpm-lock.yaml
git commit -m "feat(ui): add markdown Response + shiki code-block for chat"
```

---

## Task 2: Conversation(自动滚动)+ Message + Loader + Actions

**Files:** Create `conversation.tsx`、`message.tsx`、`loader.tsx`、`actions.tsx`(均在 `packages/ui/src/components/`)。
**Interfaces:**
- Produces: `Conversation`/`ConversationContent`/`ConversationScrollButton`、`Message`/`MessageContent`/`MessageAvatar`、`Loader`、`Actions`/`Action`。Task 4 用它们搭聊天页。

- [ ] **Step 1: 写 `conversation.tsx`**

```tsx
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

const NEAR_BOTTOM_PX = 80;

interface StickCtx {
	scrollRef: RefObject<HTMLDivElement | null>;
	atBottom: boolean;
	scrollToBottom: () => void;
}

const ConversationContext = createContext<StickCtx | null>(null);

function useStick(): StickCtx {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [atBottom, setAtBottom] = useState(true);
	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, []);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) {
			return;
		}
		const onScroll = () => {
			const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
			setAtBottom(distance < NEAR_BOTTOM_PX);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		const observer = new ResizeObserver(() => {
			if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
				el.scrollTop = el.scrollHeight;
			}
		});
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, []);
	return { scrollRef, atBottom, scrollToBottom };
}

export function Conversation({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const ctx = useStick();
	return (
		<ConversationContext.Provider value={ctx}>
			<div
				className={cn("relative flex-1 overflow-y-auto", className)}
				ref={ctx.scrollRef}
			>
				{children}
			</div>
		</ConversationContext.Provider>
	);
}

export function ConversationContent({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-4 p-4", className)}>{children}</div>
	);
}

export function ConversationScrollButton() {
	const ctx = useContext(ConversationContext);
	if (!ctx || ctx.atBottom) {
		return null;
	}
	return (
		<button
			aria-label="Scroll to bottom"
			className="-translate-x-1/2 absolute bottom-4 left-1/2 rounded-full border bg-background p-2 shadow-md hover:bg-accent"
			onClick={ctx.scrollToBottom}
			type="button"
		>
			<ArrowDownIcon className="size-4" />
		</button>
	);
}
```

- [ ] **Step 2: 写 `message.tsx`**

```tsx
import { cn } from "@better-agent/ui/lib/utils";
import { BotIcon, UserIcon } from "lucide-react";
import type { ReactNode } from "react";

type Role = "user" | "assistant" | "system";

export function MessageAvatar({ role }: { role: Role }) {
	const isUser = role === "user";
	return (
		<div
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full border",
				isUser ? "bg-primary text-primary-foreground" : "bg-muted"
			)}
		>
			{isUser ? (
				<UserIcon className="size-4" />
			) : (
				<BotIcon className="size-4" />
			)}
		</div>
	);
}

export function MessageContent({
	children,
	from,
	className,
}: {
	children: ReactNode;
	from: Role;
	className?: string;
}) {
	const isUser = from === "user";
	return (
		<div
			className={cn(
				"max-w-[80%] rounded-lg px-3 py-2",
				isUser ? "bg-primary text-primary-foreground" : "bg-muted",
				className
			)}
		>
			{children}
		</div>
	);
}

export function Message({
	from,
	children,
	className,
}: {
	from: Role;
	children: ReactNode;
	className?: string;
}) {
	const isUser = from === "user";
	return (
		<div
			className={cn(
				"flex items-start gap-2",
				isUser ? "flex-row-reverse" : "flex-row",
				className
			)}
		>
			<MessageAvatar role={from} />
			{children}
		</div>
	);
}
```

- [ ] **Step 3: 写 `loader.tsx`**

```tsx
import { cn } from "@better-agent/ui/lib/utils";

export function Loader({ className }: { className?: string }) {
	return (
		<span className={cn("inline-flex gap-1", className)}>
			<span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
			<span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
			<span className="size-1.5 animate-bounce rounded-full bg-current" />
		</span>
	);
}
```

- [ ] **Step 4: 写 `actions.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

const COPIED_RESET_MS = 1500;

export function Actions({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center gap-1", className)}>{children}</div>
	);
}

export function Action({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button
			aria-label={label}
			className="text-muted-foreground hover:text-foreground"
			onClick={onClick}
			size="icon-xs"
			type="button"
			variant="ghost"
		>
			{children}
		</Button>
	);
}

export function CopyAction({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Action
			label="Copy message"
			onClick={() => {
				navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_RESET_MS);
			}}
		>
			{copied ? (
				<CheckIcon className="size-3.5" />
			) : (
				<CopyIcon className="size-3.5" />
			)}
		</Action>
	);
}
```

- [ ] **Step 5: 校验 + 提交**

Run: `pnpm -F @better-agent/ui check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/ui/src/components/conversation.tsx packages/ui/src/components/message.tsx packages/ui/src/components/loader.tsx packages/ui/src/components/actions.tsx
git commit -m "feat(ui): add conversation, message, loader, actions chat components"
```

---

## Task 3: Reasoning(Base UI Collapsible)+ PromptInput

**Files:** Create `reasoning.tsx`、`prompt-input.tsx`(`packages/ui/src/components/`)。
**Interfaces:**
- Consumes: `@base-ui/react/collapsible`;`@better-agent/ui` 的 `Button`/`Response`。
- Produces: `Reasoning`/`ReasoningTrigger`/`ReasoningContent`;`PromptInput`/`PromptInputTextarea`/`PromptInputToolbar`/`PromptInputTools`/`PromptInputSubmit`。

- [ ] **Step 1: 写 `reasoning.tsx`**

```tsx
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function Reasoning({
	isStreaming,
	children,
	className,
}: {
	isStreaming: boolean;
	children: ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(isStreaming);
	// 流式时自动展开,结束后自动收起。
	useEffect(() => {
		setOpen(isStreaming);
	}, [isStreaming]);
	return (
		<Collapsible.Root
			className={cn("rounded-none border bg-muted/40 p-2", className)}
			onOpenChange={setOpen}
			open={open}
		>
			{children}
		</Collapsible.Root>
	);
}

export function ReasoningTrigger({ label }: { label: string }) {
	return (
		<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
			<BrainIcon className="size-3.5" />
			<span>{label}</span>
			<ChevronDownIcon className="size-3.5 transition-transform data-[panel-open]:rotate-180" />
		</Collapsible.Trigger>
	);
}

export function ReasoningContent({ children }: { children: ReactNode }) {
	return (
		<Collapsible.Panel className="mt-2 whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
			{children}
		</Collapsible.Panel>
	);
}
```

> 说明:base-ui `Collapsible.Trigger` 在展开时带 `data-panel-open` 属性,用它驱动箭头旋转;若该版本属性名不同(如 `data-open`),按实际渲染的属性微调选择器并在报告中说明。

- [ ] **Step 2: 写 `prompt-input.tsx`**

```tsx
import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useRef } from "react";

const MAX_TEXTAREA_PX = 200;

export function PromptInput({
	onSubmit,
	children,
	className,
}: {
	onSubmit: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<form
			className={cn("rounded-lg border bg-background p-2", className)}
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{children}
		</form>
	);
}

export function PromptInputTextarea({
	value,
	onChange,
	onSubmit,
	disabled,
	placeholder = "Type a message… (Enter to send)",
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	const ref = useRef<HTMLTextAreaElement | null>(null);
	const resize = () => {
		const el = ref.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
		}
	};
	return (
		<textarea
			aria-label="Message"
			className="max-h-[200px] w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
			disabled={disabled}
			onChange={(event) => {
				onChange(event.target.value);
				resize();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSubmit();
				}
			}}
			placeholder={placeholder}
			ref={ref}
			rows={1}
			value={value}
		/>
	);
}

export function PromptInputToolbar({ children }: { children: ReactNode }) {
	return <div className="flex items-center justify-between pt-1">{children}</div>;
}

export function PromptInputTools({ children }: { children?: ReactNode }) {
	return <div className="flex items-center gap-1">{children}</div>;
}

export function PromptInputSubmit({
	status,
	onStop,
}: {
	status: "idle" | "streaming";
	onStop: () => void;
}) {
	if (status === "streaming") {
		return (
			<Button
				aria-label="Stop"
				onClick={onStop}
				size="icon-sm"
				type="button"
				variant="destructive"
			>
				<SquareIcon className="size-3.5" />
			</Button>
		);
	}
	return (
		<Button aria-label="Send" size="icon-sm" type="submit">
			<ArrowUpIcon className="size-4" />
		</Button>
	);
}
```

- [ ] **Step 3: 校验 + 提交**

Run: `pnpm -F @better-agent/ui check-types`
Expected: 通过。
```bash
pnpm fix
git add packages/ui/src/components/reasoning.tsx packages/ui/src/components/prompt-input.tsx
git commit -m "feat(ui): add reasoning (base-ui collapsible) and prompt-input components"
```

---

## Task 4: 把聊天页换成新组件

**Files:**
- Modify: `apps/admin/src/components/sessions/conversation.tsx`
- Delete: `apps/admin/src/components/sessions/message-bubble.tsx`、`composer.tsx`

**Interfaces:** Consumes Task 1–3 的所有组件 + 既有 `useChat`/`ChatMessage`。

- [ ] **Step 1: 重写 `apps/admin/src/components/sessions/conversation.tsx`**

```tsx
import { Badge } from "@better-agent/ui/components/badge";
import { Card } from "@better-agent/ui/components/card";
import { CopyAction } from "@better-agent/ui/components/actions";
import {
	Conversation as ConversationRoot,
	ConversationContent,
	ConversationScrollButton,
} from "@better-agent/ui/components/conversation";
import { Loader } from "@better-agent/ui/components/loader";
import { Message, MessageContent } from "@better-agent/ui/components/message";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { Response } from "@better-agent/ui/components/response";
import { useState } from "react";

import { type ChatMessage, useChat } from "./use-chat";

function AssistantBody({ message }: { message: ChatMessage }) {
	const streamingEmpty =
		message.status === "streaming" && message.text === "";
	return (
		<div className="flex flex-col gap-2">
			{message.reasoning === "" ? null : (
				<Reasoning isStreaming={message.status === "streaming"}>
					<ReasoningTrigger label="Reasoning" />
					<ReasoningContent>{message.reasoning}</ReasoningContent>
				</Reasoning>
			)}
			{streamingEmpty ? <Loader /> : <Response>{message.text}</Response>}
			{message.status === "error" ? (
				<Badge variant="destructive">error</Badge>
			) : null}
			{message.status === "complete" && message.text !== "" ? (
				<CopyAction text={message.text} />
			) : null}
		</div>
	);
}

function ChatRow({ message }: { message: ChatMessage }) {
	if (message.role === "user") {
		return (
			<Message from="user">
				<MessageContent from="user">
					<p className="whitespace-pre-wrap text-sm">{message.text}</p>
				</MessageContent>
			</Message>
		);
	}
	return (
		<Message from="assistant">
			<MessageContent className="bg-transparent px-0 py-0" from="assistant">
				<AssistantBody message={message} />
			</MessageContent>
		</Message>
	);
}

export function Conversation({ sessionId }: { sessionId: string }) {
	const { messages, streaming, send, stop } = useChat(sessionId);
	const [text, setText] = useState("");
	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || streaming) {
			return;
		}
		send(trimmed);
		setText("");
	};
	return (
		<Card className="flex h-chat flex-col gap-0 overflow-hidden p-0">
			<ConversationRoot>
				<ConversationContent>
					{messages.length === 0 ? (
						<p className="text-muted-foreground text-sm">No messages yet.</p>
					) : (
						messages.map((message) => (
							<ChatRow key={message.id} message={message} />
						))
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</ConversationRoot>
			<div className="border-t p-3">
				<PromptInput onSubmit={submit}>
					<PromptInputTextarea
						disabled={streaming}
						onChange={setText}
						onSubmit={submit}
						value={text}
					/>
					<PromptInputToolbar>
						<PromptInputTools />
						<PromptInputSubmit
							onStop={stop}
							status={streaming ? "streaming" : "idle"}
						/>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</Card>
	);
}
```

- [ ] **Step 2: 删除旧组件**

Run:
```bash
git rm apps/admin/src/components/sessions/message-bubble.tsx apps/admin/src/components/sessions/composer.tsx
```
Expected: 两文件删除;确认无其它引用:`grep -rn "message-bubble\|composer" apps/admin/src` 应只剩 `prompt-input`/无关命中(无 `./composer`/`./message-bubble` import)。

- [ ] **Step 3: 构建 + 类型校验 + 提交**

Run: `pnpm -F @better-agent/admin build`
Expected: 成功。
Run: `pnpm -F @better-agent/admin exec tsc --noEmit`
Expected: 通过。
```bash
pnpm fix
git add apps/admin/src/components/sessions/conversation.tsx
git commit -m "feat(admin): use ai-elements chat components on the session page"
```

---

## Task 5: 端到端渲染验证(截图)

**Files:** 无(纯验证 + 可选 README)。

- [ ] **Step 1: 起服务并渲染**

```bash
pnpm db:start
CORS_ORIGIN=http://localhost:3001,http://localhost:3002 pnpm -F server dev
pnpm -F @better-agent/admin dev
```
前置:Providers 配一个 enabled 凭证、Agents 建一个 agent(已有则跳过)。进 `http://localhost:3002/agents/<id>`,新建/选一个 session。

- [ ] **Step 2: 逐项截图核对**

发一条带 Markdown 的消息(如包含 \`\`\`代码块、列表、**粗体**),**实际渲染并截图**确认:
1. 用户气泡右对齐(头像 + bubble);assistant 左对齐。
2. assistant 文本按 **Markdown** 渲染:粗体/列表/链接;代码块**语法高亮** + 右上角复制按钮可用。
3. 思考(reasoning)模型时:出现可折叠的 Reasoning 块,流式时展开、结束收起。
4. 流式中:空 assistant 显示 **Loader**(跳动点);输入区按钮变 **Stop(方块)**,点击中断。
5. 内容超出时**自动滚到底部**;向上滚动出现"回到底部"圆钮。
6. assistant 完成后下方有**复制**按钮,点击复制全文。
7. 占位 key 时 assistant 显示 `error` 徽章(传输管线已修,见 853cd6e)。

> 真实逐字流式需有效 provider key;占位 key 下验证布局/Markdown/折叠/Loader/复制/滚动即可。

- [ ] **Step 3:(可选)记录**:如需,在 `apps/admin/README.md` 注明聊天使用 `@better-agent/ui` 的 ai-elements 组件。提交(若有改动):
```bash
pnpm fix
git add apps/admin/README.md
git commit -m "docs(admin): note ai-elements chat components"
```

---

## Self-Review（计划作者自检结论）

- **设计覆盖**:覆盖确认的范围 —— 全 Markdown + shiki 代码高亮(Task 1)、Conversation 自动滚动 + Message + Loader + Actions 复制(Task 2)、Reasoning(Base UI Collapsible)+ PromptInput(Task 3)、聊天页接线(Task 4)、渲染截图验证(Task 5)。组件全在 `@better-agent/ui`、底层 Base UI、不动后端/`use-chat`/`ChatMessage`。图片/语音/Sources 等显式划出。
- **占位扫描**:无 TBD;每步含完整组件代码或精确命令+期望输出。
- **类型一致性**:`CodeBlock`(Task1)被 `Response`(Task1)用;`Response`/`Conversation`/`Message`/`Loader`/`CopyAction`/`Reasoning*`/`PromptInput*`(Task1–3)被 Task4 聊天页一致消费;`ChatMessage { id, role, text, reasoning, status }` 形状沿用既有 `use-chat`,Task4 按 `role`/`status`/`text`/`reasoning` 读取一致;`PromptInputSubmit` 的 `status: "idle"|"streaming"` 与聊天页 `streaming ? "streaming" : "idle"` 一致。
- **已知风险**:① shiki `codeToHtml` 异步,首帧用纯 `<pre>` 兜底,流式代码可读;`dangerouslySetInnerHTML` 仅用于 shiki 已转义输出(加 biome-ignore)。② base-ui `Collapsible.Trigger` 展开态属性名(`data-panel-open` vs `data-open`)按实际渲染微调箭头选择器。③ `Button` 的 `size="icon-sm"`/`icon-xs`/`ghost` variant 在现有 button.tsx 存在(5a 见过);若某 size 名不符,用最接近的并报告。④ 自动滚动用原生容器 + ResizeObserver 小 hook(非 Radix/非 use-stick-to-bottom 依赖),流式增高时贴底;若不够顺滑,后续可换 `use-stick-to-bottom`。⑤ `prose-sm` 等 class 用的是手写 `[&_...]` 选择器(不依赖 @tailwindcss/typography 插件),避免新增插件。⑥ 组件/文件均控制在 ≤50 行函数 / ≤300 行文件;`code-block`/`prompt-input` 已拆子组件。
