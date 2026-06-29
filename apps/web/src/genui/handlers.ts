import type { UIAction } from "@curiousbus/agent-client";
import { toast } from "sonner";

export const HANDLERS: Record<string, (payload: unknown) => void> = {
	press: () => toast("Button pressed"),
};

interface RouteDeps {
	handlers: Record<string, (payload: unknown) => void>;
	sendAgentEvent: (action: UIAction) => void;
}

/** A2 routing: local intents run their handler; semantic intents go to the agent. */
export function routeAction(action: UIAction, deps: RouteDeps): void {
	if (action.target === "client") {
		const handler = deps.handlers[action.intent];
		if (handler) {
			handler(action.payload);
		}
		return;
	}
	deps.sendAgentEvent(action);
}
