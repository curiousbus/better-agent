import type { GenerativeUIChatConfig } from "@better-agent/ui/components/chat/conversation";
import { DATA_TOOLS } from "./tools";

/** The generative-UI wiring passed into the chat: when the composer toggle is
 * on, the agent gets these client-executed data tools attached to the turn.
 * Tool results render via the tool-result registry (see ./tool-renderers).
 *
 * The data tools are CLIENT (remote) tools — they only complete on Cloudflare
 * Workers because the server now coordinates results via Upstash REST
 * (cross-isolate). DATA_TOOLS here are mock/demo; swap them for real ones to
 * render real data. */
export const GENUI_CHAT_CONFIG: GenerativeUIChatConfig = {
	tools: DATA_TOOLS,
};
