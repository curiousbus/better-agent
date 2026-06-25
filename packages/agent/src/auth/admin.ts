export const SUPER_ADMIN_EMAIL = "jacksonwen001@gmail.com";

/** True when `email` is the built-in super admin or in the allowlist. */
export function isAdminEmail(email: string, allowlist: string[]): boolean {
	const normalized = email.trim().toLowerCase();
	return normalized === SUPER_ADMIN_EMAIL || allowlist.includes(normalized);
}
