import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		/** 逗号分隔的允许来源（支持 web 3001 + admin 3002 等多个 dev 前端）。 */
		CORS_ORIGIN: z
			.string()
			.min(1)
			.transform((value) => value.split(",").map((origin) => origin.trim()))
			.pipe(z.array(z.url())),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		CREDENTIALS_SECRET: z.string().min(32),
		MODELS_DEV_URL: z.url().default("https://models.dev/api.json"),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
