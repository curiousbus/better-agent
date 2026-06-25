import type { EmailSender } from "@better-agent/agent/ports";
import { log } from "evlog";
import { Resend } from "resend";

export function createEmailSender(config: {
	apiKey?: string;
	from: string;
}): EmailSender {
	if (!config.apiKey) {
		return {
			sendMagicLink({ email, url }) {
				log.info("auth", `Magic link for ${email}: ${url}`);
				return Promise.resolve();
			},
			sendPasswordReset({ email, url }) {
				log.info("auth", `Password reset for ${email}: ${url}`);
				return Promise.resolve();
			},
		};
	}
	const resend = new Resend(config.apiKey);
	return {
		async sendMagicLink({ email, url }) {
			await resend.emails.send({
				from: config.from,
				to: email,
				subject: "Your sign-in link",
				html: `<p>Click to sign in:</p><p><a href="${url}">${url}</a></p>`,
			});
		},
		async sendPasswordReset({ email, url }) {
			await resend.emails.send({
				from: config.from,
				to: email,
				subject: "Reset your password",
				html: `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`,
			});
		},
	};
}
