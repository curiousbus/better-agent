import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type ProviderCatalogRow = Awaited<
	ReturnType<Client["providers"]["catalogList"]>
>[number];

export type CredentialRow = Awaited<
	ReturnType<Client["providers"]["credentialsList"]>
>[number];

export type ModelRow = Awaited<
	ReturnType<Client["providers"]["modelsList"]>
>[number];
