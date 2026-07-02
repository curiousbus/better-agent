import { createJwtService } from "@better-agent/agent/crypto/jwt";
import {
	createMagicLinkStore,
	createPasswordResetStore,
	createRefreshTokenStore,
	createUserStore,
} from "@better-agent/db/repositories/auth-store";
import { env } from "@better-agent/env/server";
import { createEmailSender } from "./email-sender";

const ACCESS_TTL = 900;
const REFRESH_TTL = 2_592_000;
const MAGIC_LINK_TTL = 900;

type Db = Parameters<typeof createUserStore>[0];

export function buildAuthServices(db: Db) {
	return {
		jwtService: createJwtService(env.AUTH_JWT_SECRET),
		emailSender: createEmailSender({
			apiKey: env.RESEND_API_KEY,
			from: env.AUTH_EMAIL_FROM,
		}),
		authConfig: {
			webUrl: env.WEB_URL,
			adminUrl: env.ADMIN_URL,
			accessTtl: ACCESS_TTL,
			refreshTtl: REFRESH_TTL,
			magicLinkTtl: MAGIC_LINK_TTL,
			adminEmails: env.ADMIN_EMAILS,
		},
		authStores: {
			user: createUserStore(db),
			magicLink: createMagicLinkStore(db),
			passwordReset: createPasswordResetStore(db),
			refreshToken: createRefreshTokenStore(db),
		},
	};
}
