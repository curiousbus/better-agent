import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT = "better-agent.secret-box.v1";

export interface SecretBox {
	decrypt(payload: string): string;
	encrypt(plaintext: string): string;
}

export function createSecretBox(secret: string): SecretBox {
	const key = scryptSync(secret, SALT, KEY_LENGTH);

	return {
		encrypt(plaintext) {
			const iv = randomBytes(IV_LENGTH);
			const cipher = createCipheriv(ALGORITHM, key, iv);
			const encrypted = Buffer.concat([
				cipher.update(plaintext, "utf8"),
				cipher.final(),
			]);
			const tag = cipher.getAuthTag();
			return [
				iv.toString("hex"),
				tag.toString("hex"),
				encrypted.toString("hex"),
			].join(":");
		},

		decrypt(payload) {
			const [ivHex, tagHex, dataHex] = payload.split(":");
			if (!(ivHex && tagHex && dataHex)) {
				throw new Error("Invalid secret-box payload");
			}
			const decipher = createDecipheriv(
				ALGORITHM,
				key,
				Buffer.from(ivHex, "hex")
			);
			decipher.setAuthTag(Buffer.from(tagHex, "hex"));
			return Buffer.concat([
				decipher.update(Buffer.from(dataHex, "hex")),
				decipher.final(),
			]).toString("utf8");
		},
	};
}
