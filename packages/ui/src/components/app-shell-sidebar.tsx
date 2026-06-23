import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
	ACTIVE_BUTTON_CLASS,
	ActiveHighlight,
	type BrandConfig,
	CollapsibleNavItem,
	isActivePath,
	type NavChild,
	type NavSection,
} from "@better-agent/ui/components/app-shell-nav";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@better-agent/ui/components/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";

export type {
	NavChild,
	NavSection,
} from "@better-agent/ui/components/app-shell-nav";

// Hover-intent delay for the collapsed-rail tooltips. The base SidebarProvider
// uses delay=0, which flashes tooltips when the icons slide under the cursor
// during the collapse animation; a delay shows them only on a deliberate hover.
const TOOLTIP_DELAY_MS = 500;

export interface AppShellSidebarProps {
	brand: BrandConfig;
	footer?: ReactNode;
	groupLabel?: string;
	highlightLayoutId: string;
	sections: readonly NavSection[];
}

function NavItemLink({
	child,
	active,
	layoutId,
}: {
	child: NavChild;
	active: boolean;
	layoutId: string;
}) {
	return (
		<SidebarMenuItem className="relative">
			{active && <ActiveHighlight layoutId={layoutId} />}
			<SidebarMenuButton
				className={ACTIVE_BUTTON_CLASS}
				isActive={active}
				render={
					<Link
						onFocus={child.onHover}
						onPointerEnter={child.onHover}
						to={child.to}
					/>
				}
				tooltip={child.label}
			>
				<child.icon />
				<span>{child.label}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

// Brand + collapse control. Expanded: logo + title with the collapse trigger on
// the same row (right). Collapsed: just the logo, which swaps to an expand icon
// on hover (and toggles the rail open on click).
function SidebarBrand({ brand }: { brand: BrandConfig }) {
	const { state, isMobile, toggleSidebar } = useSidebar();
	const Icon = brand.icon;

	if (state === "collapsed" && !isMobile) {
		return (
			<button
				aria-label="Expand sidebar"
				className="group/brand relative flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
				onClick={toggleSidebar}
				type="button"
			>
				<Icon className="size-4 transition-opacity group-hover/brand:opacity-0" />
				<PanelLeftOpen className="absolute size-4 opacity-0 transition-opacity group-hover/brand:opacity-100" />
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2 px-1 py-0.5">
			<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
				<Icon className="size-4" />
			</div>
			<div className="flex min-w-0 flex-col">
				<span className="truncate font-semibold text-sm leading-tight">
					{brand.title}
				</span>
				{brand.subtitle && (
					<span className="truncate text-muted-foreground text-xs leading-tight">
						{brand.subtitle}
					</span>
				)}
			</div>
			<SidebarTrigger className="ml-auto" />
		</div>
	);
}

function SidebarNav({
	sections,
	pathname,
	groupLabel,
	highlightLayoutId,
}: {
	sections: readonly NavSection[];
	pathname: string;
	groupLabel?: string;
	highlightLayoutId: string;
}) {
	return (
		<SidebarGroup>
			{groupLabel && <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>}
			<SidebarGroupContent>
				<SidebarMenu>
					{sections.map((section) =>
						section.kind === "item" ? (
							<NavItemLink
								active={isActivePath(pathname, section.item.to)}
								child={section.item}
								key={section.item.to}
								layoutId={highlightLayoutId}
							/>
						) : (
							<CollapsibleNavItem
								key={section.basePath}
								layoutId={highlightLayoutId}
								pathname={pathname}
								section={section}
							/>
						)
					)}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

export function AppShellSidebar({
	brand,
	footer,
	groupLabel,
	highlightLayoutId,
	sections,
}: AppShellSidebarProps) {
	const pathname = useRouterState({
		select: (s) => s.location.pathname,
	});

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader>
				<SidebarBrand brand={brand} />
			</SidebarHeader>
			<SidebarContent>
				{/* Override the base provider's delay=0 so collapsed-rail tooltips
				    only appear on a deliberate hover, not during the collapse. */}
				<TooltipPrimitive.Provider delay={TOOLTIP_DELAY_MS}>
					<SidebarNav
						groupLabel={groupLabel}
						highlightLayoutId={highlightLayoutId}
						pathname={pathname}
						sections={sections}
					/>
				</TooltipPrimitive.Provider>
			</SidebarContent>
			{footer && (
				<SidebarFooter>
					<SidebarMenu>
						<SidebarMenuItem>{footer}</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
			)}
			<SidebarRail />
		</Sidebar>
	);
}
