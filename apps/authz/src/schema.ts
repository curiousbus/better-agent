import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

// authz_ prefixes keep these from colliding with the main server's tables when
// they share a Postgres instance.

export const inviteCodes = pgTable("authz_invite_codes", {
	id: uuid("id").primaryKey().defaultRandom(),
	code: text("code").notNull().unique(),
	label: text("label").notNull().default(""),
	source: text("source").notNull().default(""),
	maxRedemptions: integer("max_redemptions").notNull().default(1),
	redemptions: integer("redemptions").notNull().default(0),
	active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

// One grant per subject (the web user id). A grant references the code redeemed.
export const grants = pgTable("authz_grants", {
	id: uuid("id").primaryKey().defaultRandom(),
	subject: text("subject").notNull().unique(),
	codeId: uuid("code_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const authzAdmins = pgTable("authz_admins", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
