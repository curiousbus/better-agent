// Empty-table placeholder text for a composio query: shows the error message
// (e.g. an invalid API key) so failures are visible instead of a blank table.
export function queryPlaceholder(
	query: {
		isError: boolean;
		isLoading: boolean;
		error: { message: string } | null;
	},
	emptyLabel: string
): string {
	if (query.isError && query.error) {
		return query.error.message;
	}
	if (query.isLoading) {
		return "Loading…";
	}
	return emptyLabel;
}
