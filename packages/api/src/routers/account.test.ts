import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createFakeRefreshTokenStore,
	createFakeUserStore,
} from "@better-agent/agent/testing/fake-auth-stores";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const CHROME_MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FIREFOX_LINUX_UA =
	"Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";

const FUTURE = new Date(Date.now() + 1_000_000_000);

function build() {
	const userStore = createFakeUserStore();
	const refreshToken = createFakeRefreshTokenStore();
	const services = {
		stores: { user: userStore, refreshToken },
	};
	const makeClient = (authedUserId: string | null) => {
		const authedUser = authedUserId
			? { id: authedUserId, email: "u@test.com", createdAt: new Date() }
			: null;
		return createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	};
	return { userStore, refreshToken, makeClient };
}

async function seedUser(
	userStore: ReturnType<typeof createFakeUserStore>,
	refreshStore: ReturnType<typeof createFakeRefreshTokenStore>,
	email: string
) {
	const user = await userStore.findOrCreate(email);
	const tokenA = "rt_tokenA_secret";
	const tokenB = "rt_tokenB_secret";
	await refreshStore.create({
		userId: user.id,
		tokenHash: hashToken(tokenA),
		expiresAt: FUTURE,
		userAgent: CHROME_MAC_UA,
	});
	await refreshStore.create({
		userId: user.id,
		tokenHash: hashToken(tokenB),
		expiresAt: FUTURE,
		userAgent: FIREFOX_LINUX_UA,
	});
	return { user, tokenA, tokenB };
}

it("listLogins returns 2 sessions with parsed labels", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user, tokenA } = await seedUser(
		userStore,
		refreshToken,
		"a@test.com"
	);
	const client = makeClient(user.id);
	const logins = await client.account.listLogins({
		currentRefreshToken: tokenA,
	});
	expect(logins).toHaveLength(2);
	const labels = logins.map((l) => l.label).sort();
	expect(labels).toEqual(["Chrome · macOS", "Firefox · Linux"].sort());
});

it("listLogins marks the current token as current:true", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user, tokenA } = await seedUser(
		userStore,
		refreshToken,
		"b@test.com"
	);
	const client = makeClient(user.id);
	const logins = await client.account.listLogins({
		currentRefreshToken: tokenA,
	});
	const currentEntry = logins.find((l) => l.label === "Chrome · macOS");
	const otherEntry = logins.find((l) => l.label === "Firefox · Linux");
	expect(currentEntry?.current).toBe(true);
	expect(otherEntry?.current).toBe(false);
});

it("listLogins with no currentRefreshToken marks all current:false", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user } = await seedUser(userStore, refreshToken, "c@test.com");
	const client = makeClient(user.id);
	const logins = await client.account.listLogins({});
	expect(logins.every((l) => l.current === false)).toBe(true);
});

it("revokeLogin revokes only the targeted session", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user, tokenB } = await seedUser(
		userStore,
		refreshToken,
		"d@test.com"
	);
	const client = makeClient(user.id);
	const before = await client.account.listLogins({});
	expect(before).toHaveLength(2);

	const target = before.find((l) => l.label === "Chrome · macOS");
	if (!target) {
		throw new Error("target not found");
	}

	const result = await client.account.revokeLogin({ id: target.id });
	expect(result.ok).toBe(true);

	const after = await client.account.listLogins({});
	expect(after).toHaveLength(1);
	expect(after[0]?.label).toBe("Firefox · Linux");
	// tokenA is revoked; tokenB still works
	expect(await refreshToken.find(hashToken(tokenB))).not.toBeNull();
});

it("revokeLogin ignores tokens belonging to another user", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user: userA } = await seedUser(userStore, refreshToken, "e@test.com");
	const { user: userB } = await seedUser(userStore, refreshToken, "f@test.com");

	const clientB = makeClient(userB.id);
	const userALogins = await makeClient(userA.id).account.listLogins({});
	const targetId = userALogins[0]?.id ?? "";

	await clientB.account.revokeLogin({ id: targetId });

	// userA's sessions unchanged
	const afterA = await makeClient(userA.id).account.listLogins({});
	expect(afterA).toHaveLength(2);
});

function buildWithAuth() {
	const userStore = createFakeUserStore();
	const refreshToken = createFakeRefreshTokenStore();
	const jwtService = createJwtService("a-test-secret-at-least-32-chars-long!!");
	const services = {
		jwtService,
		rateLimiter: createInMemoryRateLimiter(),
		authConfig: {
			webUrl: "http://web.test",
			adminUrl: "http://admin.test",
			accessTtl: 900,
			refreshTtl: 2_592_000,
			magicLinkTtl: 900,
			adminEmails: [] as string[],
		},
		stores: { user: userStore, refreshToken },
	};
	const makeAuthedClient = (userId: string, email: string) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: { id: userId, email, createdAt: new Date() },
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	const publicClient = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: null,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
	return { userStore, makeAuthedClient, publicClient };
}

it("me.hasPassword is false for a fresh user, true after setPassword", async () => {
	const { userStore, makeAuthedClient } = buildWithAuth();
	const user = await userStore.findOrCreate("pw@test.com");
	const client = makeAuthedClient(user.id, user.email);
	const before = await client.auth.me();
	expect(before.hasPassword).toBe(false);
	await client.account.setPassword({ password: "newpassword1" });
	const after = await client.auth.me();
	expect(after.hasPassword).toBe(true);
});

it("loginWithPassword succeeds after account.setPassword", async () => {
	const { userStore, makeAuthedClient, publicClient } = buildWithAuth();
	const user = await userStore.findOrCreate("setpw@test.com");
	const authedClient = makeAuthedClient(user.id, user.email);
	await authedClient.account.setPassword({ password: "setnewpass1" });
	const result = await publicClient.auth.loginWithPassword({
		email: "setpw@test.com",
		password: "setnewpass1",
	});
	expect(result.user.email).toBe("setpw@test.com");
	expect(result.accessToken.length).toBeGreaterThan(0);
	expect(result.refreshToken.startsWith("rt_")).toBe(true);
});

it("revokeOthers leaves only the current session active", async () => {
	const { userStore, refreshToken, makeClient } = build();
	const { user, tokenA } = await seedUser(
		userStore,
		refreshToken,
		"g@test.com"
	);
	const client = makeClient(user.id);

	const result = await client.account.revokeOthers({
		currentRefreshToken: tokenA,
	});
	expect(result.ok).toBe(true);

	const remaining = await client.account.listLogins({
		currentRefreshToken: tokenA,
	});
	expect(remaining).toHaveLength(1);
	expect(remaining[0]?.current).toBe(true);
	expect(remaining[0]?.label).toBe("Chrome · macOS");
});
