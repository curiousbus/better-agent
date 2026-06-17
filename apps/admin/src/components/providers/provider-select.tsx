import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

import type { ProviderCatalogRow } from "@/utils/api-types";

export function ProviderSelect({
	providers,
	value,
	onChange,
	placeholder,
	ariaLabel,
	disabled,
	id,
	className,
}: {
	providers: ProviderCatalogRow[];
	value: string;
	onChange: (providerId: string) => void;
	placeholder: string;
	ariaLabel: string;
	disabled?: boolean;
	id?: string;
	className?: string;
}) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger
				aria-label={ariaLabel}
				className={className ?? "w-56"}
				id={id}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{providers.map((provider) => (
					<SelectItem key={provider.providerId} value={provider.providerId}>
						{provider.providerId}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
