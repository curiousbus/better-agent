import { z } from "zod";
import { adminProcedure } from "../index";

const SECRET_SETTINGS = [
	{
		key: "COMPOSIO_API_KEY",
		label: "Composio API Key",
		help: "用于 composio 工具与连接,设置后立即生效。",
	},
] as const;
const KEYS = SECRET_SETTINGS.map((s) => s.key) as [string, ...string[]];

export const settingsRouter = {
	list: adminProcedure.handler(async ({ context }) => {
		const out: {
			key: string;
			label: string;
			help: string;
			configured: boolean;
			source: string;
		}[] = [];
		for (const s of SECRET_SETTINGS) {
			const dbVal = await context.services.stores.settings.get(s.key);
			const inEnv = context.services.envSecretKeys.includes(s.key);
			let source: string;
			if (dbVal) {
				source = "db";
			} else if (inEnv) {
				source = "env";
			} else {
				source = "none";
			}
			out.push({
				key: s.key,
				label: s.label,
				help: s.help,
				configured: source !== "none",
				source,
			});
		}
		return out;
	}),
	set: adminProcedure
		.input(z.object({ key: z.enum(KEYS), value: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.set(input.key, input.value);
			return { ok: true };
		}),
	clear: adminProcedure
		.input(z.object({ key: z.enum(KEYS) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.settings.delete(input.key);
			return { ok: true };
		}),
};
