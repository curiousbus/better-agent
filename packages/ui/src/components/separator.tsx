import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@better-agent/ui/lib/utils";

function Separator({
	className,
	orientation = "horizontal",
	...props
}: SeparatorPrimitive.Props) {
	return (
		<SeparatorPrimitive
			className={cn(
				"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
				className
			)}
			data-slot="separator"
			orientation={orientation}
			{...props}
		/>
	);
}

export { Separator };
