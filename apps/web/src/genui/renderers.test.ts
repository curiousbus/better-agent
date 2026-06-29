import { expect, it } from "vitest";
import { COMPONENT_TYPES } from "./manifest";
import { RENDERERS } from "./renderers";

it("has a renderer for every manifest component type", () => {
	for (const type of COMPONENT_TYPES) {
		expect(RENDERERS[type], `missing renderer for ${type}`).toBeDefined();
	}
});
