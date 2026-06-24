import { jwtVerify, SignJWT } from "jose";

export interface JwtClaims {
	email: string;
	sub: string;
}

export interface JwtService {
	sign(claims: JwtClaims, ttlSeconds: number): Promise<string>;
	verify(token: string): Promise<JwtClaims | null>;
}

const ALG = "HS256";

export function createJwtService(secret: string): JwtService {
	const key = new TextEncoder().encode(secret);
	return {
		sign(claims, ttlSeconds) {
			const now = Math.floor(Date.now() / 1000);
			return new SignJWT({ email: claims.email })
				.setProtectedHeader({ alg: ALG })
				.setSubject(claims.sub)
				.setIssuedAt(now)
				.setExpirationTime(now + ttlSeconds)
				.sign(key);
		},
		async verify(token) {
			try {
				const { payload } = await jwtVerify(token, key);
				if (
					typeof payload.sub === "string" &&
					typeof payload.email === "string"
				) {
					return { sub: payload.sub, email: payload.email };
				}
				return null;
			} catch {
				return null;
			}
		},
	};
}
