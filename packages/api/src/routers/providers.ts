import { z } from "zod";
import { publicProcedure } from "../index";

const upsertInput = z.object({
	providerId: z.string().min(1),
	apiKey: z.string().min(1),
	baseURL: z.url().nullable().default(null),
	enabled: z.boolean().default(true),
});

export const providersRouter = {
	catalogList: publicProcedure.handler(({ context }) =>
		context.services.stores.providerCatalog.list()
	),

	catalogRefresh: publicProcedure.handler(({ context }) =>
		context.services.catalog.sync()
	),

	credentialsList: publicProcedure.handler(({ context }) =>
		context.services.stores.providerCredential.listMasked()
	),

	credentialsUpsert: publicProcedure
		.input(upsertInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.upsert(input);
			return { ok: true };
		}),

	credentialsDelete: publicProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.delete(input.providerId);
			return { ok: true };
		}),

	modelsList: publicProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(({ input, context }) =>
			context.services.stores.modelCache.listByProvider(input.providerId)
		),
};
