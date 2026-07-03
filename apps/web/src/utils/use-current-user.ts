import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

export function useCurrentUser() {
	const me = useQuery(orpc.auth.me.queryOptions());
	const email = me.data?.email ?? "";
	const initial = email ? email[0].toUpperCase() : "?";
	return { email, initial };
}
