import { cn } from "@better-agent/ui/lib/utils";
import type { SlashPickerItem, SlashPickerItemKind } from "./slash-picker";

const GROUP_LABEL: Record<SlashPickerItemKind, string> = {
	command: "Commands",
	skill: "Skills",
};

interface SlashPickerRowProps {
	active: boolean;
	itemId: string;
	name: string;
	onHover: () => void;
	onSelect: () => void;
}

function SlashPickerRow({
	active,
	itemId,
	name,
	onHover,
	onSelect,
}: SlashPickerRowProps) {
	return (
		<button
			aria-selected={active}
			className={cn(
				"flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
				active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
			)}
			id={itemId}
			onMouseDown={(event) => {
				// Selecting via the mouse must not first blur the textarea (which
				// would fire before `onClick`) — mousedown is the earliest point we
				// can intercept, so preventDefault here keeps focus in place.
				event.preventDefault();
				onSelect();
			}}
			onMouseEnter={onHover}
			role="option"
			type="button"
		>
			<span aria-hidden className="text-muted-foreground">
				/
			</span>
			{name}
		</button>
	);
}

export interface SlashPickerListProps {
	activeIndex: number;
	itemDomId: (index: number) => string;
	items: SlashPickerItem[];
	listId: string;
	onHover: (index: number) => void;
	onSelect: (item: SlashPickerItem) => void;
}

/**
 * The "/" picker dropdown itself: commands and skills as separately labeled
 * groups (a group header shows only once, ahead of its first row), scrolling
 * once the list outgrows its max height so it stays usable on narrow/short
 * viewports. Renders directly above the composer box (`bottom-full`) since
 * the composer sits pinned to the bottom of the terminal view. Purely
 * presentational — filtering/keyboard-nav state lives in `use-slash-picker`.
 */
export function SlashPickerList({
	activeIndex,
	itemDomId,
	items,
	listId,
	onHover,
	onSelect,
}: SlashPickerListProps) {
	let previousKind: SlashPickerItemKind | null = null;
	return (
		<div
			className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
			id={listId}
			role="listbox"
		>
			{items.map((item, index) => {
				const key = `${item.kind}-${item.name}`;
				const showGroupLabel = item.kind !== previousKind;
				previousKind = item.kind;
				return (
					<div key={key}>
						{showGroupLabel && (
							<div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
								{GROUP_LABEL[item.kind]}
							</div>
						)}
						<SlashPickerRow
							active={index === activeIndex}
							itemId={itemDomId(index)}
							name={item.name}
							onHover={() => onHover(index)}
							onSelect={() => onSelect(item)}
						/>
					</div>
				);
			})}
		</div>
	);
}
