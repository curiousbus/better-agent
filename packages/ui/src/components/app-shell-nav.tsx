import { Collapsible } from "@base-ui/react/collapsible";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import {
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	useSidebar,
} from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import {
	type ComponentType,
	type ReactNode,
	type SVGProps,
	useEffect,
	useState,
} from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

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

export interface BrandConfig {
	icon: IconComponent;
	subtitle?: ReactNode;
	title: string;
}

type NavGroup = Extract<NavSection, { kind: "group" }>;

// Shared active-button styling: the highlight is a motion slider, so the active
// button itself stays transparent and just lifts its text/icon above the slider.
export const ACTIVE_BUTTON_CLASS =
	"relative z-10 rounded-md text-sidebar-foreground not-data-active:hover:bg-sidebar-accent/60 not-data-active:hover:text-sidebar-foreground data-active:bg-transparent data-active:font-medium data-active:text-sidebar-primary-foreground data-active:hover:bg-transparent data-active:hover:text-sidebar-primary-foreground";

const HIGHLIGHT_SPRING = {
	type: "spring",
	stiffness: 480,
	damping: 38,
} as const;

export function ActiveHighlight({ layoutId }: { layoutId: string }) {
	return (
		<motion.div
			className="absolute inset-0 rounded-md bg-sidebar-primary"
			layoutId={layoutId}
			transition={HIGHLIGHT_SPRING}
		/>
	);
}

export function isActivePath(pathname: string, to: string) {
	return pathname.startsWith(to);
}

function PopoverNavLink({
	child,
	active,
}: {
	child: NavChild;
	active: boolean;
}) {
	return (
		<Link
			className={cn(
				"flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground text-sm hover:bg-sidebar-accent/60",
				active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
			)}
			onFocus={child.onHover}
			onPointerEnter={child.onHover}
			to={child.to}
		>
			<child.icon className="size-4 shrink-0" />
			<span className="truncate">{child.label}</span>
		</Link>
	);
}

// Collapsed rail: the group is an icon that opens its children in a hover
// popover (there's no room to expand inline).
function CollapsedNavGroup({
	section,
	pathname,
	layoutId,
}: {
	section: NavGroup;
	pathname: string;
	layoutId: string;
}) {
	const Icon = section.icon;
	const groupActive = section.items.some((item) =>
		isActivePath(pathname, item.to)
	);
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
					{section.items.map((child) => (
						<PopoverNavLink
							active={isActivePath(pathname, child.to)}
							child={child}
							key={child.to}
						/>
					))}
				</PopoverContent>
			</Popover>
		</SidebarMenuItem>
	);
}

function SubNavLink({
	child,
	active,
	layoutId,
}: {
	child: NavChild;
	active: boolean;
	layoutId: string;
}) {
	return (
		<SidebarMenuSubItem className="relative">
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
}

// Expanded rail: the group expands its children inline below the trigger.
function ExpandedNavGroup({
	section,
	pathname,
	layoutId,
	open,
	onOpenChange,
}: {
	section: NavGroup;
	pathname: string;
	layoutId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const Icon = section.icon;
	const groupActive = section.items.some((item) =>
		isActivePath(pathname, item.to)
	);
	return (
		<SidebarMenuItem>
			<Collapsible.Root onOpenChange={onOpenChange} open={open}>
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
						{section.items.map((child) => (
							<SubNavLink
								active={isActivePath(pathname, child.to)}
								child={child}
								key={child.to}
								layoutId={layoutId}
							/>
						))}
					</SidebarMenuSub>
				</Collapsible.Panel>
			</Collapsible.Root>
		</SidebarMenuItem>
	);
}

export function CollapsibleNavItem({
	section,
	pathname,
	layoutId,
}: {
	section: NavGroup;
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

	if (state === "collapsed" && !isMobile) {
		return (
			<CollapsedNavGroup
				layoutId={layoutId}
				pathname={pathname}
				section={section}
			/>
		);
	}
	return (
		<ExpandedNavGroup
			layoutId={layoutId}
			onOpenChange={setOpen}
			open={open}
			pathname={pathname}
			section={section}
		/>
	);
}
