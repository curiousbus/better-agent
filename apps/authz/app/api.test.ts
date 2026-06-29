import { describe, expect, it } from "vitest";
import { authHeaders } from "./api";

describe("authHeaders", () => {
	it("builds the bearer header from a token, omits when absent", () => {
		expect(authHeaders("t")).toEqual({ Authorization: "Bearer t" });
		expect(authHeaders(null)).toEqual({});
	});
});
