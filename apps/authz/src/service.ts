import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { grants, inviteCodes } from "./schema";

const CODE_BYTES = 9;

function generateCode(): string {
	return randomBytes(CODE_BYTES).toString("base64url");
}

/** Is the subject authorized? True iff it holds a grant to an active code. */
export async function authorize(db: Db, subject: string): Promise<boolean> {
	const rows = await db
		.select({ active: inviteCodes.active })
		.from(grants)
		.innerJoin(inviteCodes, eq(grants.codeId, inviteCodes.id))
		.where(eq(grants.subject, subject))
		.limit(1);
	return rows[0]?.active === true;
}

export interface RedeemResult {
	authorized: boolean;
	reason?: string;
}

export async function redeem(
	db: Db,
	subject: string,
	code: string
): Promise<RedeemResult> {
	const rows = await db
		.select()
		.from(inviteCodes)
		.where(eq(inviteCodes.code, code))
		.limit(1);
	const row = rows[0];
	if (!row?.active) {
		return { authorized: false, reason: "Invalid or inactive code" };
	}
	const held = await db
		.select({ codeId: grants.codeId })
		.from(grants)
		.where(eq(grants.subject, subject))
		.limit(1);
	// Idempotent: re-redeeming the code you already hold is fine.
	if (held[0]?.codeId === row.id) {
		return { authorized: true };
	}
	if (row.redemptions >= row.maxRedemptions) {
		return { authorized: false, reason: "Code already used" };
	}
	await db
		.insert(grants)
		.values({ subject, codeId: row.id })
		.onConflictDoUpdate({ target: grants.subject, set: { codeId: row.id } });
	await db
		.update(inviteCodes)
		.set({ redemptions: sql`${inviteCodes.redemptions} + 1` })
		.where(eq(inviteCodes.id, row.id));
	return { authorized: true };
}

export function listCodes(db: Db) {
	return db
		.select()
		.from(inviteCodes)
		.orderBy(sql`${inviteCodes.createdAt} desc`);
}

export async function createCode(
	db: Db,
	input: { label: string; source: string }
) {
	const inserted = await db
		.insert(inviteCodes)
		.values({ code: generateCode(), label: input.label, source: input.source })
		.returning();
	return inserted[0];
}

/**
 * Deactivate a code and return the subjects whose grants reference it — the
 * worker then pushes a cache invalidation to the main server for each.
 */
export async function revokeCode(db: Db, codeId: string): Promise<string[]> {
	await db
		.update(inviteCodes)
		.set({ active: false })
		.where(eq(inviteCodes.id, codeId));
	const rows = await db
		.select({ subject: grants.subject })
		.from(grants)
		.where(eq(grants.codeId, codeId));
	return rows.map((r) => r.subject);
}
