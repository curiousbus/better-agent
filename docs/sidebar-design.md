
> 目标：任何 agent 读完本文档，**不看现有代码也能从零复刻出与现状像素级一致的侧边栏**，并知道如何为新页面增删导航项。
>
> 现状：admin 和 web 两个 app 的侧边栏**共用同一套实现**，差异只在「配置数据」和「外壳接入」两处。理解这点是复刻的关键。

---

## 1. 三层架构（必须先理解）

侧边栏被刻意拆成三层，职责严格分离：

```
┌─────────────────────────────────────────────────────────────┐
│ 应用层（每个 app 各一份，只有数据/品牌差异）                    │
│   apps/admin/src/components/sidebar.tsx  → <AdminSidebar/>     │
│   apps/web/src/components/sidebar.tsx     → <WebSidebar/>      │
│   职责：声明 sections（导航数据）、brand、footer，调用中间层    │
└───────────────────────────────┬─────────────────────────────┘
                                 │ props (sections / brand / ...)
┌───────────────────────────────▼─────────────────────────────┐
│ 中间层（共享，唯一一份）                                        │
│   packages/ui/src/components/app-shell-sidebar.tsx            │
│   → <AppShellSidebar/> + 内部 <CollapsibleNavItem/>           │
│   职责：把 sections 渲染成菜单；active 高亮动画；折叠态 popover；│
│         可折叠分组的展开/收起逻辑                               │
└───────────────────────────────┬─────────────────────────────┘
                                 │ 组合 shadcn primitive
┌───────────────────────────────▼─────────────────────────────┐
│ 底层 primitive（shadcn 风格，唯一一份）                         │
│   packages/ui/src/components/sidebar.tsx                     │
│   → SidebarProvider / Sidebar / SidebarInset / SidebarTrigger │
│     / SidebarMenu* / SidebarRail / useSidebar ...            │
│   职责：展开/折叠状态机、cookie 持久化、Cmd+B 快捷键、移动端     │
│         Sheet、尺寸 token、所有视觉 primitive                  │
└───────────────────────────────┬─────────────────────────────┘
                                 │
┌───────────────────────────────▼─────────────────────────────┐
│ 外壳接入层（每个 app 的 layout 路由）                           │
│   apps/admin/src/routes/admin.tsx                            │
│   apps/web/src/routes/app.tsx                                │
│   职责：<SidebarProvider> 包裹 <XxxSidebar/> + <SidebarInset> │
│         + 顶栏（SidebarTrigger / Breadcrumbs / 右侧动作区）     │
└─────────────────────────────────────────────────────────────┘
```

**复刻顺序**：底层 primitive → 中间层 AppShellSidebar → 应用层数据 → 外壳接入。下面逐层交代。

---

## 2. 依赖与约定

`packages/ui/package.json` 里复刻侧边栏需要的依赖（版本固定，勿用 `^`/`~`）：

| 依赖 | 版本 | 用途 |
|---|---|---|
| `@base-ui/react` | `1.4.1` | Popover、merge-props、use-render（primitive 的 polymorphism） |
| `motion` | `12.23.6` | active 高亮的 `layoutId` 滑动动画（`motion/react`） |
| `lucide-react` | `0.546.0` | 所有图标 |
| `class-variance-authority` | `0.7.1` | `SidebarMenuButton` 的 variant |
| `@tanstack/react-router` | catalog | `Link` / `useRouterState` |
| `@tanstack/react-query` | `5.100.10` | web 侧 hover 预取（可选） |

约定（来自 `.claude/rules/`）：

- 文件名 **kebab-case**：`app-shell-sidebar.tsx`、`user-avatar-menu.tsx`。
- UI primitive 一律放 `packages/ui`，**app 私有组件**（`AdminSidebar` / `WebSidebar`）放各自 `apps/*/src/components/`。
- 禁止 Tailwind 任意值（`w-[99px]`）和 inline `style`——例外是 primitive 里用 CSS 变量驱动尺寸（`--sidebar-width` 等），那是设计系统 token，不是魔法值。
- 颜色全部走 `--sidebar-*` token（见 §7），不要硬编码颜色。

---

## 3. 底层 primitive — `packages/ui/src/components/sidebar.tsx`

这是 shadcn 的 sidebar primitive（已适配 base-ui 的 `useRender`/`mergeProps`，而非 Radix `asChild`）。完整导出 25 个符号，复刻时**整文件照搬**即可。下面只交代关键不变量——改这些会破坏整套行为。

### 3.1 尺寸常量（顶部）

```ts
const SIDEBAR_COOKIE_NAME = "sidebar_state";        // 展开/折叠状态存这个 cookie
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;    // 7 天
const SIDEBAR_WIDTH = "16rem";                       // 展开宽度（桌面）
const SIDEBAR_WIDTH_MOBILE = "18rem";                // 移动端 Sheet 宽度
const SIDEBAR_WIDTH_ICON = "3rem";                   // 折叠（icon-only）宽度
const SIDEBAR_KEYBOARD_SHORTCUT = "b";               // Cmd/Ctrl+B 切换
```

### 3.2 状态机：`SidebarProvider` + `useSidebar`

- Context 形状：`{ state: "expanded"|"collapsed", open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }`。
- `useSidebar()` 不在 Provider 内调用会抛错——所有用到侧边栏状态的组件（含中间层、`UserAvatarMenu`）都必须在 `<SidebarProvider>` 子树内。
- `defaultOpen` 默认 `true`。支持受控（传 `open` + `onOpenChange`）与非受控。
- **cookie 持久化**：每次 `setOpen` 都写 `document.cookie`，下次进页面恢复（注意：当前 `defaultOpen` 是 `true` 硬编码，SSR 不读 cookie 回填，刷新瞬间总是展开态——如需 SSR 恢复要自己从 cookie 读初值传给 `defaultOpen`）。
- **Cmd/Ctrl+B 快捷键**：Provider 内挂 `keydown` 监听，`toggleSidebar()`。
- `isMobile` 来自 `useIsMobile()`（见 §3.5），`< 768px` 为移动端。
- Provider 渲染一个 `group/sidebar-wrapper` 的 wrapper div，注入 `--sidebar-width` / `--sidebar-width-icon` CSS 变量，并用 `has-data-[variant=inset]:bg-sidebar` 让 inset 变体的外层背景变成 sidebar 色。

### 3.3 `Sidebar` 组件三种渲染路径

`<Sidebar side="left" variant="sidebar"|"floating"|"inset" collapsible="offcanvas"|"icon"|"none">`：

1. **`collapsible="none"`** → 一个固定宽度的纯 flex 列，无折叠。
2. **移动端（`isMobile`）** → 用 `<Sheet>`（抽屉）渲染，宽度 `--sidebar-width-mobile`，受 `openMobile` 控制，关闭按钮隐藏（`[&>button]:hidden`），带 sr-only 的标题/描述满足 a11y。
3. **桌面端** → 双层结构：
   - 一个 `sidebar-gap` div 负责"占位"，让主内容区随折叠平滑收缩（`transition-[width] duration-200`）。
   - 一个 `fixed` 的 `sidebar-container` 真正渲染内容，靠 `data-collapsible` / `data-side` / `data-state` / `data-variant` 这些 **data 属性 + group 选择器**驱动所有折叠/侧别/变体样式。

> **关键**：折叠态的所有视觉变化（宽度、隐藏文字、图标居中）都不是 JS 写死的，而是 `group-data-[collapsible=icon]:...` 这类 Tailwind 选择器响应 `data-collapsible`。复刻时 data 属性一个都不能漏。

### 3.4 本项目实际使用的变体

两个 app 都用：

```tsx
<Sidebar collapsible="icon" variant="inset">
```

- `variant="inset"`：主内容区（`SidebarInset`）变成一张带圆角/阴影、四周留 margin 的"卡片"，外层底色是 sidebar 色 → 视觉上侧边栏与内容区悬浮在同一背景上。
- `collapsible="icon"`：折叠时收成 `3rem` 宽的 icon-only 条，而非完全划走。

### 3.5 `useIsMobile` — `packages/ui/src/hooks/use-mobile.ts`

```ts
const MOBILE_BREAKPOINT = 768;
// matchMedia(max-width: 767px) + window.innerWidth < 768
// 初值 undefined，effect 后置真，返回 !!isMobile
```

### 3.6 关键 primitive 速查

| 组件 | 作用 / 关键样式 |
|---|---|
| `SidebarHeader` / `SidebarFooter` | `flex flex-col gap-2 p-2` 的头/尾容器 |
| `SidebarContent` | 可滚动主体，`no-scrollbar`、折叠时 `overflow-hidden` |
| `SidebarGroup` / `SidebarGroupLabel` / `SidebarGroupContent` | 分组容器；`GroupLabel` 在折叠态淡出（`group-data-[collapsible=icon]:opacity-0`） |
| `SidebarMenu` / `SidebarMenuItem` | `<ul>` / `<li>`，`MenuItem` 是 `group/menu-item relative` |
| `SidebarMenuButton` | **核心按钮**，cva 变体（variant: default/outline；size: default `h-8`/sm `h-7`/lg `h-12`）。支持 `isActive`（写 `data-active`）、`tooltip`（折叠态才显示，`side="right"`）、`render`（polymorphic，传 `<Link>` 即渲染成链接）。折叠态强制 `size-8! p-2!`，图标 `[&_svg]:size-4`。 |
| `SidebarMenuSub` / `SidebarMenuSubItem` / `SidebarMenuSubButton` | 二级菜单：左侧有 `border-l` 竖线，`SubButton` 高度 `h-7`，折叠态整组 `hidden`。 |
| `SidebarTrigger` | `variant="ghost" size="icon-sm"` 的 `PanelLeftIcon` 按钮，点击 `toggleSidebar()`。放在顶栏。 |
| `SidebarRail` | 侧边栏右缘一条隐形可点击竖条，点击切换折叠；hover 显示 `bg-sidebar-border`。 |
| `SidebarInset` | 主内容区 `<main>`；inset 变体下 `m-2 ml-0 rounded-lg shadow-sm`，折叠态 `ml-2`。 |

`SidebarMenuButton` 之所以能既当 `<button>` 又当 `<Link>`，靠 base-ui 的 `useRender({ defaultTagName, props: mergeProps(...), render })`——`render` 传一个元素就用它当宿主。这是替代 Radix `asChild` 的写法，复刻时保持一致。

---

## 4. 中间层 — `packages/ui/src/components/app-shell-sidebar.tsx`

这是**两个 app 共享的"装配器"**：吃一份 `sections` 配置，吐出完整菜单。它定义了导航数据的类型契约。

### 4.1 数据类型（契约）

```ts
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type NavChild = {
  to: string;            // 路由路径
  label: string;         // 显示文案
  icon: IconComponent;   // lucide 图标组件（传组件本身，不是 <Icon/>）
  onHover?: () => void;  // 可选：hover/focus 触发（web 用来预取数据）
};

export type NavSection =
  | { kind: "item"; item: NavChild }                       // 单条导航
  | { kind: "group"; icon: IconComponent; label: string;   // 可折叠分组
      basePath: string; items: readonly NavChild[] };
```

- `kind: "item"` → 顶层单条链接。
- `kind: "group"` → 可折叠分组，`basePath` 用于"当前路由是否落在该组内"的判断（控制默认展开 & 折叠态高亮），`items` 是子项。

### 4.2 Props

```ts
export interface AppShellSidebarProps {
  brand: { icon: IconComponent; title: string; subtitle?: ReactNode };
  footer?: ReactNode;            // 可选，渲染在 SidebarFooter
  groupLabel?: string;           // 可选，菜单组顶部的小标题（如 "Workspace"）
  highlightLayoutId: string;     // motion 高亮的 layoutId，每个 app 必须唯一
  sections: readonly NavSection[];
}
```

### 4.3 active 高亮：motion `layoutId` 滑块（核心视觉）

这是整个侧边栏最有辨识度的细节，**务必照抄**：

- 当前激活项**不是**靠背景 class，而是一个**绝对定位的 `motion.div` 滑块**：
  ```tsx
  <motion.div
    className="absolute inset-0 rounded-md bg-sidebar-primary"
    layoutId={highlightLayoutId}
    transition={{ type: "spring", stiffness: 480, damping: 38 }}
  />
  ```
- 所有激活态共用**同一个 `layoutId`** → 切换路由时 motion 自动让这块高亮**从旧位置滑到新位置**（spring 动画）。
- 因此 `highlightLayoutId` 在每个 app 内必须唯一且稳定：admin 用 `"admin-sidebar-active"`，web 用 `"web-sidebar-active"`。两个 app 各自独立，不会互相干扰。
- 配套：承载滑块的 `SidebarMenuItem` 必须 `className="relative"`；按钮本身要 `relative z-10` 浮在滑块之上，且激活态把背景设为**透明**（`data-active:bg-transparent`）、文字用 `text-sidebar-primary-foreground`——让那块滑块成为唯一的色块。

按钮激活态的完整 class（item 与折叠 popover trigger 通用）：
```
relative z-10 rounded-md text-sidebar-foreground
not-data-active:hover:bg-sidebar-accent/60 not-data-active:hover:text-sidebar-foreground
data-active:bg-transparent data-active:font-medium data-active:text-sidebar-primary-foreground
data-active:hover:bg-transparent data-active:hover:text-sidebar-primary-foreground
```

**激活判定**：`pathname.startsWith(to)`。`pathname` 来自 `useRouterState({ select: (s) => s.location.pathname })`。

### 4.4 单条 item 渲染（`kind: "item"`）

`SidebarMenuItem.relative` → 若 active 放 motion 滑块 → `SidebarMenuButton`（`isActive`、`tooltip={label}`、`render={<Link to={to} onPointerEnter/onFocus={onHover}>`）。`tooltip` 让折叠态 hover 时在右侧弹出 label。

### 4.5 可折叠分组（`CollapsibleNavItem`）

分组在**展开态**和**折叠态**渲染完全不同：

**展开态**：一个父按钮（图标 + label + 右侧 `ChevronRight`，`open` 时旋转 90°），点击切换本地 `open` state；展开时下方渲染 `SidebarMenuSub`（带左竖线），每个子项同样用「relative + motion 滑块 + SubButton」结构高亮。

**折叠态**（`state === "collapsed" && !isMobile`）：父按钮包进 base-ui `<Popover>`，`<PopoverTrigger openOnHover>`——**hover 即弹出**子菜单浮层（`side="right"`，`w-48`）。浮层里手写 `<Link>` 列表（不复用 SubButton），active 子项用 `bg-sidebar-accent`。分组自身在折叠态若 `groupActive` 也显示 motion 滑块。

**两个关键 effect / 逻辑**：

1. `defaultOpen` = `pathname.startsWith(section.basePath)`：首次渲染时，当前路由落在该组内就默认展开。
2. 组内 `useEffect`：当任一子路由变 active（`groupActive`）时 `setOpen(true)`——这样从折叠态 hover-popover 点进某子页后，再展开侧边栏该组是打开的。**这是项目里少数被允许的 `useEffect`**（订阅"路由→展开态"的外部派生状态，`useQuery` 覆盖不到）。

> web 的"新闻资讯"组特意把 `basePath` 设为 `/app/news`，但 `items` 同时含 `/app/social/x`——靠上面的 effect，切到 `/app/social/x` 时组也会自动展开。增删分组时注意 `basePath` 只决定"初次默认展开"，真正的 active 判定看每个子项的 `to`。

### 4.6 外层骨架（`AppShellSidebar` 返回）

```
<Sidebar collapsible="icon" variant="inset">
  <SidebarHeader>  品牌区：方形图标底（bg-primary）+ title + subtitle，折叠态隐藏文字
  <SidebarContent>
    <SidebarGroup>
      [groupLabel &&] <SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>  ← 遍历 sections，item/group 分别渲染
  [footer &&] <SidebarFooter><SidebarMenu><SidebarMenuItem>{footer}
  <SidebarRail/>
```

品牌图标容器：`size-7 rounded-md bg-primary text-primary-foreground`，折叠态 `size-8`；文字块 `group-data-[collapsible=icon]:hidden`。

---

## 5. 应用层 — 各 app 的 sidebar.tsx

### 5.1 Admin（`apps/admin/src/components/sidebar.tsx`）

- 纯静态 `sections`（模块级常量，无 hook）：用户、审计日志、定时任务、新人推荐、模型供应商、智能体（都是 `kind:"item"`），最后一个"数据"是 `kind:"group"`（子项：X / 每日研报 / 宏观 / 美联储沟通，`basePath:"/admin/data"`）。
- `brand`：图标 `LineChart`，title `"AI Financial"`，subtitle 是个 `<Badge variant="secondary">管理后台</Badge>`。
- `highlightLayoutId="admin-sidebar-active"`，**无 footer、无 groupLabel**（admin 的用户菜单在顶栏，不在侧边栏底部）。
- 自定义图标示例：`XLogoIcon` 从 `@/components/icons/x-logo` 引入，证明 `icon` 可以是任意符合 `IconComponent` 签名的组件，不限 lucide。

### 5.2 Web（`apps/web/src/components/sidebar.tsx`）

- `sections` 在**组件内部**构造（不是模块常量），因为要用 `useQueryClient()` 给"市场总览"挂 `onHover` 预取：
  ```ts
  const queryClient = useQueryClient();
  // item: { to:"/app/markets", ..., onHover: () => prefetchDefaultMarketOverview(queryClient) }
  ```
  `prefetchDefaultMarketOverview` 调 `orpc.marketOverview.getOverview.queryOptions({ input:{ region:"CN" } })` + `staleTime:60_000` 预取——hover 导航项就提前拉数据，点进去秒开。
- 结构：市场总览(item) / 自选股(item) / 新闻资讯(group) / 研报(group) / 知识库(group)。
- `brand`：`LineChart` + title + subtitle `<span>Research</span>`。
- **有 footer**：`<UserAvatarMenu/>`（见 §6）；**有 `groupLabel="Workspace"`**。
- `highlightLayoutId="web-sidebar-active"`。

> 差异小结：admin 把账户菜单放顶栏、侧边栏无底部；web 把账户菜单作为侧边栏 footer，并用 hover 预取。其余完全一致。

---

## 6. footer 内容 — `UserAvatarMenu`（web）

`apps/web/src/components/user-avatar-menu.tsx`：

- 用 `authClient.useSession()` 拿登录态；`isPending` 显示 `SidebarMenuButton size="lg"` 内的 Skeleton；未登录显示"Sign in"链接。
- 已登录：`SidebarMenuButton size="lg"`（包 `<Avatar size-7>` + 名字，折叠态隐藏名字）作为 `DropdownMenuTrigger`，菜单含 Profile / Logout。
- `side` 自适应：`isMobile ? "bottom" : state === "collapsed" ? "right" : "top"`——读 `useSidebar()` 的 `state`/`isMobile` 决定下拉方向。
- 名字首字母 `initialsFor()` 作为 `AvatarFallback`。

> admin 也有同名 `UserAvatarMenu`，但用在**顶栏右侧**而非侧边栏 footer。

---

## 7. 主题 token（`packages/ui/src/styles/globals.css`）

侧边栏所有颜色走 `--sidebar-*`，light/dark 各一套，并在 `@theme` 里映射成 `--color-sidebar-*`（即 Tailwind 的 `bg-sidebar` / `text-sidebar-foreground` 等）：

```css
:root {
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);            /* active 滑块底色 */
  --sidebar-primary-foreground: oklch(0.985 0 0); /* active 文字 */
  --sidebar-accent: oklch(0.97 0 0);              /* hover 底色 */
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}
.dark { /* 对应一套深色值，--sidebar-primary 变成蓝紫 oklch(0.488 0.243 264.376) */ }
@theme inline {
  --color-sidebar: var(--sidebar);
  --color-sidebar-primary: var(--sidebar-primary);
  /* ...其余同理映射 ... */
}
```

> 还有 `themes.generated.css`（`theme:sync` 脚本生成的 shadcn 主题）提供另一组 token，由 ThemeDrawer 切换。复刻最小集只需 globals.css 那 8 个 `--sidebar-*` + 8 个 `--color-sidebar-*`。圆角统一跟随全局 `--radius`（ThemeDrawer 控制），primitive 内部用 `rounded-md`，不要在使用点硬编码圆角。

---

## 8. 外壳接入 — layout 路由

两个 app 的 layout 结构**完全对称**。Admin（`apps/admin/src/routes/admin.tsx`）：

```tsx
function AdminLayout() {
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator className="mx-1 h-4" orientation="vertical" />
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-2">
            <ThemeDrawer />
            <UserAvatarMenu />   {/* web 这里是 <HeaderTaskBar/> + <ThemeDrawer/> */}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6" data-slot="page">
          <AnimatedOutlet routeId={Route.id} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

要点（两 app 一致）：

1. **`<SidebarProvider>` 必须是最外层**，把 `<XxxSidebar/>` 和 `<SidebarInset>` 都包进去（否则 `useSidebar` 抛错）。
2. `<SidebarInset>` 是主内容区，内部第一块是固定高 `h-12` 的顶栏：左 `SidebarTrigger`（`-ml-1` 视觉对齐）→ 竖 `Separator` → `Breadcrumbs`；右侧动作区（admin: ThemeDrawer + UserAvatarMenu；web: HeaderTaskBar + ThemeDrawer）。
3. 顶栏下方 `flex-1 overflow-auto p-6` 容器渲染 `<AnimatedOutlet>`（路由出口，带过渡）。web 额外包一层 `<OnboardingGate>`。
4. layout 路由用 `beforeLoad` 做鉴权（admin 还校验 `role === "admin"|"superadmin"`）。这与侧边栏无关，但复刻整个外壳时一并交代。

> 注意 TanStack Start 路由约定（rules/frontend.md #1）：`admin.tsx` / `app.tsx` 是带 `<Outlet/>`（这里是 `AnimatedOutlet`）的 **layout**，子页面是 `admin.users.tsx` 之类。新增页面 = 新建子路由文件 + 在对应 `sidebar.tsx` 的 `sections` 里加一条，**无需改中间层/底层**。

---

## 9. 复刻 checklist（按序执行）

1. **装依赖**：确认 `packages/ui` 有 §2 的依赖（base-ui、motion、lucide、cva），版本固定。
2. **token**：把 §7 的 `--sidebar-*` 与 `--color-sidebar-*` 加进 `globals.css`（light + dark）。
3. **底层 primitive**：整文件落 `packages/ui/src/components/sidebar.tsx`（导出 §3.6 全部符号）+ `packages/ui/src/hooks/use-mobile.ts`。保持所有 `data-*` 属性和 group 选择器不变。
4. **Popover primitive**：`packages/ui/src/components/popover.tsx`（base-ui 封装，折叠态分组浮层用）。
5. **中间层**：落 `packages/ui/src/components/app-shell-sidebar.tsx`，导出 `AppShellSidebar` + `NavChild` / `NavSection` 类型。务必照抄 motion 滑块（同一 `layoutId` + spring transition）、折叠态 popover、`CollapsibleNavItem` 的两个 effect/逻辑。
6. **应用层**：每个 app 建 `apps/<app>/src/components/sidebar.tsx`，声明 `sections` + `brand`，传**唯一**的 `highlightLayoutId`。需要预取/动态数据就在组件内构造 sections（参考 web）。
7. **footer/账户菜单**：决定账户菜单放侧边栏 footer（web）还是顶栏（admin）。
8. **外壳接入**：layout 路由用 `<SidebarProvider>` 包 `<XxxSidebar/>` + `<SidebarInset>`，顶栏放 `SidebarTrigger` + Breadcrumbs + 动作区（§8）。

### 验收点（逐条肉眼核对）

- [ ] 桌面默认展开 `16rem`；点 `SidebarTrigger` 或按 **Cmd/Ctrl+B** 折叠成 `3rem` icon 条，刷新后状态由 cookie 恢复（注意当前 `defaultOpen` 硬编码 true 的限制，见 §3.2）。
- [ ] 切换路由时 active 高亮**滑块平滑移动**（不是闪现）；同一时刻全局只有一块高亮。
- [ ] 折叠态 hover 单条 item 右侧弹 tooltip；hover 分组右侧弹子菜单 popover。
- [ ] 展开态点分组父项展开/收起，`ChevronRight` 旋转；进入某分组子路由时该组自动展开。
- [ ] `< 768px` 侧边栏变成抽屉 Sheet（`18rem`）。
- [ ] `variant="inset"` 下主内容区是带圆角/阴影、四周留白的卡片，底色为 sidebar 色。
- [ ] light/dark 切换颜色正确，圆角跟随全局 `--radius`。

---

## 10. 常见改动速记

| 想做的事 | 改哪里 |
|---|---|
| 加一个顶层导航 | 对应 app `sidebar.tsx` 的 `sections` push 一条 `{ kind:"item", item:{ to,label,icon } }` |
| 加一个可折叠分组 | push `{ kind:"group", icon, label, basePath, items:[...] }` |
| 给某项加 hover 预取 | 在该 `NavChild` 加 `onHover`，并把 sections 移进组件内（需要 `queryClient`） |
| 改激活高亮颜色 | 改 `--sidebar-primary` / `--sidebar-primary-foreground` token |
| 改折叠/展开宽度 | 改 primitive 顶部 `SIDEBAR_WIDTH*` 常量 |
| 账户菜单位置 | footer（传 `footer={<UserAvatarMenu/>}`）或顶栏（layout 里放） |
| 换品牌/副标题 | 改 `brand`（`subtitle` 可传任意 ReactNode，如 Badge） |

> 绝大多数业务改动只动**应用层 sections**，中间层和底层 primitive 是稳定的共享代码——非必要不改，改了影响所有 app。
