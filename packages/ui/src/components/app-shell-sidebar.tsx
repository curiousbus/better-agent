import { Collapsible } from "@base-ui/react/collapsible";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
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
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail,
	useSidebar,
} from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import {
	type ComponentType,
	type ReactNode,
	type SVGProps,
	useEffect,
	useState,
} from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavChild {
	icon: IconComponent;
	label: string;
	onHover?: () => void;
	to: string;
}

export type NavSection =
	| { kind: "item"; item: NavChild }
	| {
			kind: "group";
			icon: IconComponent;
			label: string;
			basePath: string;
			items: readonly NavChild[];
	  };

export interface AppShellSidebarProps {
	brand: { icon: IconComponent; title: string; subtitle?: ReactNode };
	footer?: ReactNode;
	groupLabel?: string;
	highlightLayoutId: string;
	sections: readonly NavSection[];
}

// Shared active-button styling: the highlight is a motion slider, so the active
// button itself stays transparent and just lifts its text/icon above the slider.
const ACTIVE_BUTTON_CLASS =
	"relative z-10 rounded-md text-sidebar-foreground not-data-active:hover:bg-sidebar-accent/60 not-data-active:hover:text-sidebar-foreground data-active:bg-transparent data-active:font-medium data-active:text-sidebar-primary-foreground data-active:hover:bg-transparent data-active:hover:text-sidebar-primary-foreground";

const HIGHLIGHT_SPRING = {
	type: "spring",
	stiffness: 480,
	damping: 38,
} as const;

function ActiveHighlight({ layoutId }: { layoutId: string }) {
	return (
		<motion.div
			className="absolute inset-0 rounded-md bg-sidebar-primary"
			layoutId={layoutId}
			transition={HIGHLIGHT_SPRING}
		/>
	);
}

function isActivePath(pathname: string, to: string) {
	return pathname.startsWith(to);
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

function CollapsibleNavItem({
	section,
	pathname,
	layoutId,
}: {
	section: Extract<NavSection, { kind: "group" }>;
	pathname: string;
	layoutId: string;
}) {
	const { state, isMobile } = useSidebar();
	const groupActive = section.items.some((item) =>
		isActivePath(pathname, item.to)
	);
	const [open, setOpen] = useState(() => pathname.startsWith(section.basePath));

	// When a child route becomes active (e.g. navigated to from the collapsed
	// hover-popover), make sure the group is expanded once the rail re-opens.
	useEffect(() => {
		if (groupActive) {
			setOpen(true);
		}
	}, [groupActive]);

	const Icon = section.icon;
	const collapsed = state === "collapsed" && !isMobile;

	if (collapsed) {
		return (
			<SidebarMenuItem className="relative">
				{groupActive && <ActiveHighlight layoutId={layoutId} />}
				<Popover>
					<PopoverTrigger
						openOnHover
						render={
							<SidebarMenuButton
								className={ACTIVE_BUTTON_CLASS}
								isActive={groupActive}
							>
								<Icon />
								<span>{section.label}</span>
							</SidebarMenuButton>
						}
					/>
					<PopoverContent
						align="start"
						className="w-48 gap-0.5 p-1"
						side="right"
						sideOffset={8}
					>
						<div className="px-2 py-1 font-medium text-muted-foreground text-xs">
							{section.label}
						</div>
						{section.items.map((child) => {
							const active = isActivePath(pathname, child.to);
							return (
								<Link
									className={cn(
										"flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground text-sm hover:bg-sidebar-accent/60",
										active &&
											"bg-sidebar-accent font-medium text-sidebar-accent-foreground"
									)}
									key={child.to}
									onFocus={child.onHover}
									onPointerEnter={child.onHover}
									to={child.to}
								>
									<child.icon className="size-4 shrink-0" />
									<span className="truncate">{child.label}</span>
								</Link>
							);
						})}
					</PopoverContent>
				</Popover>
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem>
			<Collapsible.Root onOpenChange={setOpen} open={open}>
				<Collapsible.Trigger
					render={
						<SidebarMenuButton
							className={cn(
								ACTIVE_BUTTON_CLASS,
								groupActive && "text-sidebar-foreground"
							)}
						>
							<Icon />
							<span>{section.label}</span>
							<ChevronRight className="ml-auto transition-transform duration-200 data-[panel-open]:rotate-90" />
						</SidebarMenuButton>
					}
				/>
				<Collapsible.Panel>
					<SidebarMenuSub>
						{section.items.map((child) => {
							const active = isActivePath(pathname, child.to);
							return (
								<SidebarMenuSubItem className="relative" key={child.to}>
									{active && <ActiveHighlight layoutId={layoutId} />}
									<SidebarMenuSubButton
										className={ACTIVE_BUTTON_CLASS}
										isActive={active}
										render={
											<Link
												onFocus={child.onHover}
												onPointerEnter={child.onHover}
												to={child.to}
											/>
										}
									>
										<child.icon />
										<span>{child.label}</span>
									</SidebarMenuSubButton>
								</SidebarMenuSubItem>
							);
						})}
					</SidebarMenuSub>
				</Collapsible.Panel>
			</Collapsible.Root>
		</SidebarMenuItem>
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
	const BrandIcon = brand.icon;

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader>
				<div className="flex items-center gap-2 px-1 py-0.5">
					<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground group-data-[collapsible=icon]:size-8">
						<BrandIcon className="size-4" />
					</div>
					<div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
						<span className="truncate font-semibold text-sm leading-tight">
							{brand.title}
						</span>
						{brand.subtitle && (
							<span className="truncate text-muted-foreground text-xs leading-tight">
								{brand.subtitle}
							</span>
						)}
					</div>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					{groupLabel && <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>}
					<SidebarGroupContent>
						<SidebarMenu>
							{sections.map((section) => {
								if (section.kind === "item") {
									return (
										<NavItemLink
											active={isActivePath(pathname, section.item.to)}
											child={section.item}
											key={section.item.to}
											layoutId={highlightLayoutId}
										/>
									);
								}
								return (
									<CollapsibleNavItem
										key={section.basePath}
										layoutId={highlightLayoutId}
										pathname={pathname}
										section={section}
									/>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
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
