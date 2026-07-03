export class XError extends Error {
	override readonly name: string = "XError";
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
	}
}

export class XAuthError extends XError {
	// 401/403 → token disabled
	override readonly name: string = "XAuthError";
}

export class XRateLimitError extends XError {
	// 429 → token cooling 15min
	override readonly name: string = "XRateLimitError";
}

export class XNotFoundError extends XError {
	// 404 → 账号侧问题，不罚 token
	override readonly name: string = "XNotFoundError";
}

export class XDuplicateAccountError extends XError {
	// twitterUserId 已被其他账号占用
	override readonly name: string = "XDuplicateAccountError";
	readonly existingAccountId: string;
	readonly twitterUserId: string;
	constructor(
		message: string,
		existingAccountId: string,
		twitterUserId: string
	) {
		super(message);
		this.existingAccountId = existingAccountId;
		this.twitterUserId = twitterUserId;
	}
}

export class NoActiveTokenError extends XError {
	// token 池空
	override readonly name: string = "NoActiveTokenError";
}
