import { z } from "zod";
import { adminProcedure, authorizedUserProcedure } from "../index";

const upsertInput = z.object({
	providerId: z.string().min(1),
	apiKey: z.string().min(1),
	baseURL: z.url().nullable().default(null),
	enabled: z.boolean().default(true),
});

export const providersRouter = {
	catalogList: adminProcedure.handler(({ context }) =>
		context.services.stores.providerCatalog.list()
	),

	catalogRefresh: adminProcedure.handler(({ context }) =>
		context.services.catalog.sync()
	),

	credentialsList: adminProcedure.handler(({ context }) =>
		context.services.stores.providerCredential.listMasked()
	),

	credentialsUpsert: adminProcedure
		.input(upsertInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.upsert(input);
			return { ok: true };
		}),

	credentialsDelete: adminProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(async ({ input, context }) => {
			await context.services.stores.providerCredential.delete(input.providerId);
			return { ok: true };
		}),

	modelsList: adminProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(({ input, context }) =>
			context.services.stores.modelCache.listByProvider(input.providerId)
		),

	// Web-safe reads for agent creation: enabled provider ids (no secrets) and
	// their models. Available to any authorized user (not just admins).
	available: authorizedUserProcedure.handler(async ({ context }) => {
		const creds = await context.services.stores.providerCredential.listMasked();
		return creds
			.filter((cred) => cred.enabled)
			.map((cred) => ({ providerId: cred.providerId }));
	}),

	models: authorizedUserProcedure
		.input(z.object({ providerId: z.string().min(1) }))
		.handler(({ input, context }) =>
			context.services.stores.modelCache.listByProvider(input.providerId)
		),
};
