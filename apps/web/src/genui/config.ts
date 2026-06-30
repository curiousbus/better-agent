import type { GenerativeUIChatConfig } from "@better-agent/ui/components/chat/conversation";
import { defineComponents } from "@curiousbus/agent-client";
import { HANDLERS } from "./handlers";
import { MANIFEST } from "./manifest";
import { RENDERERS } from "./renderers";

const ui = defineComponents(MANIFEST);

/** The generative-UI wiring passed into the chat: when the composer toggle is on,
 * the agent gets this schema and replies render via these components.
 *
 * NOTE: no client-side data tools are wired here. Client (remote) tools need a
 * cross-isolate coordinator (Redis / Durable Object) to work on Cloudflare
 * Workers — the streaming request and submitToolResult land on different
 * isolates, so without one the tool round-trip times out. The deployed env has
 * no REDIS_URL, so we let the agent generate UI directly from the prompt
 * (inventing sample content). Re-add `tools: DATA_TOOLS` once Redis is provisioned. */
export const GENUI_CHAT_CONFIG: GenerativeUIChatConfig = {
	outputSchema: ui.outputSchema,
	renderers: RENDERERS,
	tools: [],
	handlers: HANDLERS,
};
