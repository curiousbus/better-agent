import type { GenerativeUIChatConfig } from "@better-agent/ui/components/chat/conversation";
import { defineComponents } from "@curiousbus/agent-client";
import { HANDLERS } from "./handlers";
import { MANIFEST } from "./manifest";
import { RENDERERS } from "./renderers";
import { DATA_TOOLS } from "./tools";

const ui = defineComponents(MANIFEST);

/** The generative-UI wiring passed into the chat: when the composer toggle is on,
 * the agent gets this schema + data tools and replies render via these components.
 *
 * The data tools are CLIENT (remote) tools — they only complete on Cloudflare
 * Workers because the server now coordinates results via Upstash REST
 * (cross-isolate). DATA_TOOLS here are mock/demo; swap them for real ones to
 * render real data. */
export const GENUI_CHAT_CONFIG: GenerativeUIChatConfig = {
	outputSchema: ui.outputSchema,
	renderers: RENDERERS,
	tools: DATA_TOOLS,
	handlers: HANDLERS,
};
