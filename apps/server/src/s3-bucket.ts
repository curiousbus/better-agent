import { AwsClient } from "aws4fetch";
import type { R2Bucket, R2ObjectBody } from "./attachment-store";

// S3-protocol implementation of the attachment bucket for non-Workers runtimes
// (k3s/prod). Points at R2's S3 endpoint (or any S3-compatible store): the
// same bucket the Workers deployment reaches through its native binding.

export interface S3BucketConfig {
	accessKeyId: string;
	bucket: string;
	/** e.g. https://<account_id>.r2.cloudflarestorage.com */
	endpoint: string;
	secretAccessKey: string;
}

const OK = 200;
const NOT_FOUND = 404;

export function createS3Bucket(config: S3BucketConfig): R2Bucket {
	const aws = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		// R2 ignores region but the SigV4 signature needs one.
		region: "auto",
	});
	const objectUrl = (key: string) =>
		`${config.endpoint}/${config.bucket}/${encodeURIComponent(key)}`;

	return {
		async get(key): Promise<R2ObjectBody | null> {
			const res = await aws.fetch(objectUrl(key));
			if (res.status === NOT_FOUND) {
				return null;
			}
			if (res.status !== OK) {
				throw new Error(`S3 GET ${key} failed: ${res.status}`);
			}
			const bytes = await res.arrayBuffer();
			return { arrayBuffer: () => Promise.resolve(bytes) };
		},
		async put(key, value) {
			const body =
				value instanceof ArrayBuffer
					? value
					: value.buffer.slice(
							value.byteOffset,
							value.byteOffset + value.byteLength
						);
			const res = await aws.fetch(objectUrl(key), {
				method: "PUT",
				body: body as ArrayBuffer,
			});
			if (!res.ok) {
				throw new Error(`S3 PUT ${key} failed: ${res.status}`);
			}
		},
		async delete(key) {
			const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
			if (!(res.ok || res.status === NOT_FOUND)) {
				throw new Error(`S3 DELETE ${key} failed: ${res.status}`);
			}
		},
	};
}
