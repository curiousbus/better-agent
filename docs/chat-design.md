# Chat Design Language

Status: **proposal for review.** No code written yet. This defines the shared design
language for the two chat surfaces and how one component system serves both.

## Design read

A product chat surface (not a marketing page) for two audiences:

- **User chat** (`apps/web`): calm, focused, consumer-grade. The agent's internals are
  hidden by default. Reading comfort and a quiet UI win.
- **Debug chat** (`apps/admin`): dense, inspectable, cockpit-grade. Everything the agent
  did is exposed: reasoning, tool calls, tokens, latency, raw events.

The two surfaces are the **same conversation, at two densities**. Density is the single
axis of variation. Everything else (theme, type, layout skeleton, motion) is shared and
locked. This mirrors the layering already used in `docs/sidebar-design.md`.

### Dials (from design-taste-frontend, product-adapted)

| Surface     | VARIANCE | MOTION | DENSITY |
| ----------- | -------- | ------ | ------- |
| User chat   | 2        | 3      | 3 (comfortable) |
| Debug chat  | 2        | 2      | 8 (compact / inspect) |

Low variance is correct for chat: a conversation wants predictable rhythm, not
asymmetric layout games.

---

## 1. The unifying idea: three layers, two density modes

Same shape as the sidebar architecture, so the codebase stays consistent.

```
Layer 1  Primitives            packages/ui/src/components/*
         (shadcn + ai-elements)  message, conversation, prompt-input, reasoning,
                                  response, loader, actions  (already exist)
                                  + tool-call, message-meta, attachment, chat-empty (new)

Layer 2  Shared assembler       packages/ui  <ChatThread>, <ChatComposer>, <ChatShell>
         (the convergence point)  driven by a ChatConfig context (density + slots)

Layer 3  Per-app wiring         apps/web    user config: comfortable, internals hidden
                                 apps/admin  debug config: compact, internals exposed,
                                             + inspector panel
```

The admin chat today (`apps/admin/src/components/sessions/conversation.tsx`) hardcodes the
message-mapping and composer inline. Layer 2 extracts that into a shared `ChatThread` /
`ChatComposer` so `apps/web` reuses it instead of forking.

### ChatConfig (the one prop that diverges)

```ts
type ChatDensity = "comfortable" | "compact";

type ChatConfig = {
  density: ChatDensity;
  showReasoning: "hidden" | "collapsed" | "expanded";
  showMeta: boolean;        // model · tokens · latency strip under each turn
  showToolDetail: "summary" | "raw";
  messageActions: ("copy" | "retry" | "edit" | "raw")[];
};
```

- **Web** → `comfortable`, reasoning `collapsed`, meta `false`, tools `summary`,
  actions `[copy, retry, edit]`.
- **Admin** → `compact`, reasoning `expanded`, meta `true`, tools `raw`,
  actions `[copy, retry, raw]`, plus the inspector panel.

Density resolves to concrete tokens (not scattered magic numbers):

| Token              | comfortable          | compact            |
| ------------------ | -------------------- | ------------------ |
| thread max width   | `max-w-3xl` centered | `max-w-none` full  |
| turn gap           | `gap-6`              | `gap-3`            |
| assistant prose    | `text-[15px] leading-7` | `text-sm leading-6` |
| message padding    | `px-4 py-3`          | `px-3 py-2`        |
| meta strip         | hidden               | `text-xs font-mono` |

---

## 2. Layout

### User chat (`apps/web`)

```
┌───────────┬─────────────────────────────────────────────┐
│           │  conversation title          model ·  new +  │  topbar (h ≤ 56px)
│ sidebar   ├─────────────────────────────────────────────┤
│ (history) │                                             │
│           │            ┌───────────────────────┐        │  thread: centered
│  + new    │            │  assistant (no bubble) │        │  max-w-3xl
│  convo 1  │            └───────────────────────┘        │
│  convo 2  │                    ┌──────────────┐          │  user: right bubble
│           │                    │ user bubble  │          │
│  ───────  │            ┌───────────────────────┐        │
│  user ▾   │            │  assistant            │        │
├───────────┴─────────────────────────────────────────────┤
│            ┌─────────────────────────────────┐           │  composer pinned
│            │  Ask anything…           [send]  │           │  same max-w-3xl
│            └─────────────────────────────────┘           │
└──────────────────────────────────────────────────────────┘
```

- Full-height shell: `min-h-[100dvh]`, sidebar + `SidebarInset` (per sidebar-design.md).
  The web sidebar already plans a history nav + user-avatar footer.
- Thread scrolls; composer is pinned to the bottom of the inset, **same max width** as the
  thread so the input lines up under the messages.
- **Replace `--height-chat: 70vh` + the embedding `Card`.** A real page chat is a
  full-height flex region, not a fixed-height card.

### Debug chat (`apps/admin`)

```
┌──────────┬──────────────────────────────────┬───────────────┐
│ sidebar  │ agent ▾  session ▾   new  ⚙ raw  │  Inspector    │  resizable
│ Agents   ├──────────────────────────────────┤  ┌─────────┐  │
│ Provider │ assistant turn                   │  │ message │  │  selected turn:
│          │   ▸ reasoning (expanded)         │  │ tokens  │  │  model params,
│          │   ▸ tool: search(args) → result  │  │ latency │  │  token usage,
│          │   model · 412 tok · 1.2s         │  │ raw evt │  │  tool I/O,
│          │ user turn                        │  │ system  │  │  finish reason
│          ├──────────────────────────────────┤  └─────────┘  │
│          │  message…                 [send] │               │
└──────────┴──────────────────────────────────┴───────────────┘
   Tabs under the thread:  Conversation | Raw events | Timeline
```

- Same `ChatThread` in `compact` density, full width (no centering), inspector on the right
  via shadcn **Resizable**. On narrow screens the inspector collapses into a **Sheet**.
- Meta strip (`font-mono`) under every assistant turn: model, token in/out, latency, finish
  reason. Reasoning + tool calls expanded inline.

---

## 3. Typography

Already configured: **Geist Variable** (sans) + **Geist Mono Variable**. Keep both, no new
fonts (skill: avoid Inter-as-default — Geist already satisfies this).

| Role                    | Treatment                                |
| ----------------------- | ---------------------------------------- |
| Assistant prose (user)  | `font-sans text-[15px] leading-7`, prose width capped by thread |
| Assistant prose (admin) | `font-sans text-sm leading-6`            |
| User message            | `font-sans text-sm`                       |
| Inline code / code block| `font-mono` (shiki dual-theme, already wired) |
| Metadata, tokens, timings, tool args | `font-mono text-xs` |
| Topbar title            | `font-sans text-sm font-medium`           |

Mono is the "machine voice": anything the agent emits as data (counts, ids, latency, raw
args) is mono; anything it says to a human is sans. One clean register split, no mixing
within a line.

---

## 4. Theme & color

Keep the existing OKLCH **neutral grayscale** tokens in `packages/ui/src/styles/globals.css`.
Do not introduce a new palette. Both apps already share this file — that is the design
language's backbone and the source of light/dark parity.

### Role colors (locked)

| Element              | Light                       | Dark                        |
| -------------------- | --------------------------- | --------------------------- |
| User bubble          | `bg-primary text-primary-foreground` | same (inverts via tokens) |
| Assistant            | transparent, `text-foreground` (no bubble) | same |
| Reasoning / tool blocks | `bg-muted text-muted-foreground`, `border` | same |
| Error                | `destructive`               | `destructive`               |
| Streaming indicator  | `muted-foreground` dots     | same                        |

This is exactly what `message.tsx` does today (user = primary bubble, assistant = no
bubble). Keep it — it is the Claude/ChatGPT reading pattern and right for long markdown.

### Color decisions (locked)

1. **Accent: monochrome.** The product base stays neutral grayscale. `destructive` red is
   the *only* non-neutral, reserved for errors. Admin role differentiation (tool vs
   reasoning vs error) is done with **border + mono label**, not hue. No AI-purple.
2. **Dark sidebar highlight → neutral.** Change `--sidebar-primary` in `.dark` from the
   blue-purple `oklch(0.488 0.243 264.376)` to neutral (match `--primary`) so it passes the
   Color Consistency Lock.

### Shape lock

One radius scale, already set: `--radius: 0.625rem`. Bubbles, blocks, composer, cards all
use `rounded-lg`. No mixed corner systems.

---

## 5. UX patterns (shared behaviors)

### Message turns

- **User**: right-aligned bubble, `primary` background, `whitespace-pre-wrap`.
- **Assistant**: left, full-width markdown via `<Response>` (GFM + shiki). No bubble.
- **No per-message avatars in `comfortable`** (ChatGPT-style): role is implied by alignment
  + bubble, keeping long reads quiet. In `compact`, a thin role gutter/label marks turns.

### Streaming

- Empty streaming turn → `<Loader>` (3 dots, exists). Tokens stream into `<Response>`.
- The thread auto-scrolls to bottom while streaming; `<ConversationScrollButton>` appears
  when the user scrolls up (exists). Wrap the live region in `aria-live="polite"`.
- Composer shows **Stop** while streaming (`PromptInputSubmit status="streaming"` → onStop,
  exists).

### Reasoning

- `<Reasoning>` collapsible exists. Web: `collapsed` (one line "Thought for Ns", click to
  open). Admin: `expanded` by default. Streams in mono/muted.

### Tool calls (new shared primitive `<ToolCall>`)

- Collapsible block: header `tool · <name>` + status (pending / ok / error), body shows
  args + result.
- Web (`summary`): friendly one-liner ("Searched the web", result hidden behind a
  disclosure).
- Admin (`raw`): args + result as `font-mono` JSON, expanded.

### Full state cycle (skill-mandated)

| State    | User                                   | Admin                                  |
| -------- | -------------------------------------- | -------------------------------------- |
| Empty    | "Ask anything" + a few starter prompts | "No messages. Send to start a trace."  |
| Loading  | Loader dots + Stop                     | same + live meta counting              |
| Error    | inline `destructive` badge + **Retry** | same + raw error in inspector          |
| Stopped  | "Stopped" marker + Retry/Resume        | same                                   |
| Skeleton | `Skeleton` rows on session load        | same                                   |

Currently only error-as-badge exists; the rest are new and shared.

### Composer

- Auto-growing textarea, max height then internal scroll (exists).
- **Enter** sends, **Shift+Enter** newline (exists). Disabled while streaming.
- Slots: left = attachments / model selector (admin), right = send/stop. `<ChatComposer>`
  exposes these as slots so both surfaces share the shell.

### Message actions

- Hover-revealed row under each turn. Web: copy, retry, edit-and-resend. Admin: copy,
  retry, "view raw" (jumps to inspector). `CopyAction` exists.

---

## 6. Motion

Restrained (MOTION 2-3). Everything honors `prefers-reduced-motion`.

- Message enter: fade + 4px slide-up, ~150ms, once. (Motion `whileInView`/initial, or CSS.)
- Reasoning / tool expand: height/opacity transition, ~150ms.
- Scroll-to-bottom button: fade in/out.
- Streaming caret: optional blinking caret at the text tail.
- No parallax, no marquee, no scroll-hijack. This is product UI.

---

## 7. Component inventory

### Exists — keep (Layer 1)

`message`, `conversation`, `prompt-input`, `reasoning`, `response`, `loader`, `actions`,
plus `badge`, `card`, `skeleton`, `tabs`, `dialog`, `dropdown-menu`, `select`, `textarea`,
`code-block`.

### Add — Layer 1 primitives

- `tool-call.tsx` — collapsible tool invocation (summary/raw).
- `message-meta.tsx` — mono metadata strip (admin density).
- `attachment.tsx` — file/image chip for composer + message.
- `chat-empty.tsx` — empty-state with starter prompts.

### Add — Layer 2 assembler (the convergence)

- `chat-thread.tsx` — maps messages → turns, owns scroll + states, reads ChatConfig.
- `chat-composer.tsx` — composer shell with slots.
- `chat-shell.tsx` — full-height layout region (thread + pinned composer).
- `chat-provider.tsx` — ChatConfig context + density tokens.

### Add — shadcn components to install

`resizable` (admin inspector), `sheet` (mobile inspector / mobile history),
`scroll-area`, `tooltip`, `avatar`, `separator`, `collapsible` (if not via base-ui already).

### Per-app (Layer 3)

- `apps/web`: user ChatConfig, history sidebar, starter prompts, full-height route.
- `apps/admin`: debug ChatConfig, inspector panel, Conversation/Raw/Timeline tabs;
  refactor existing `sessions/conversation.tsx` to consume Layer 2.

---

## 8. Accessibility

- Live region `aria-live="polite"` around streaming output.
- Composer has a real `<label>` (visually hidden), send button has `aria-label`.
- Full keyboard path: focus composer, send, navigate turns, open reasoning/tool blocks.
- Contrast: user bubble is `primary`/`primary-foreground` (passes AA both modes); muted
  blocks checked against muted-foreground. Focus rings via `--ring` (exists).
- Reduced motion collapses all transitions to instant.

---

## 9. What changes vs today

- Extract admin's inline thread/composer into shared Layer 2 components.
- Drop fixed `--height-chat`/Card embedding in favor of a full-height `ChatShell`.
- Add tool-call, meta, attachment, empty-state, and the missing UX states.
- Resolve the dark-sidebar blue-purple vs neutral accent inconsistency.

---

## 10. Decisions (locked in review)

1. **Accent**: monochrome. `destructive` red for errors only; admin roles via border + mono
   label, not hue.
2. **Dark sidebar purple**: change `--sidebar-primary` (dark) to neutral.
3. **User-chat avatars**: dropped (ChatGPT-style). Compact density keeps a thin role gutter.
4. **Admin inspector**: right-side resizable panel, collapses to a Sheet on narrow screens.

5. **Web history sidebar**: deferred. Ship the chat route first; add history later. The
   `ChatShell` is built so a sidebar slots in without reworking the thread/composer.
6. **Starter prompts / empty state**: placeholder copy drafted below (§11), to be replaced
   with real product copy later.

## 11. Placeholder copy

Neutral, concrete, no filler verbs, no em-dashes. Replace when product copy exists.

### User chat empty state (`apps/web`)

- Heading: **How can I help?**
- Subline: *Ask a question, paste something in, or pick a starting point below.*
- Starter prompts (4, two-column grid on desktop, stacked on mobile):
  - **Summarize this** — paste a document and get the key points.
  - **Explain some code** — drop in a snippet and ask what it does.
  - **Draft a reply** — turn a few notes into a written response.
  - **Plan a task** — break a goal into clear steps.

### Composer placeholder

- User chat: `Ask anything…`
- Admin chat: `Send a message to the agent…`

### Admin empty state (`apps/admin`)

- `No messages yet. Send one to start a trace.`

### Other strings

- Stopped marker: `Stopped`
- Error badge: `Error` + inline `Retry`
- Reasoning collapsed label (web): `Thought for {n}s`
- Tool summary (web): `{verb} {object}` e.g. `Searched the web`
