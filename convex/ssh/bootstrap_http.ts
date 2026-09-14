import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";
import { httpStatus } from "../http_status";

const maxBodyBytes = 4096;
const maxAllocationIdLength = 100;

async function readBody(request: Request) {
	const reader = request.body?.getReader();
	if (reader === undefined) {
		return null;
	}
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) {
				break;
			}
			size += next.value.length;
			if (size > maxBodyBytes) {
				await reader.cancel();
				return "tooLarge" as const;
			}
			chunks.push(next.value);
		}
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

function toRegistration(bytes: Uint8Array) {
	let input: unknown;
	try {
		input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return null;
	}
	if (
		input === null ||
		typeof input !== "object" ||
		!("allocationId" in input) ||
		typeof input.allocationId !== "string" ||
		input.allocationId.length > maxAllocationIdLength ||
		!("token" in input) ||
		typeof input.token !== "string" ||
		!("hostKey" in input) ||
		typeof input.hostKey !== "string"
	) {
		return null;
	}
	return {
		allocationId: input.allocationId,
		token: input.token,
		hostKey: input.hostKey,
	};
}

export const registerSshHostKey = httpAction(async (ctx, request) => {
	const body = await readBody(request);
	if (body === "tooLarge") {
		return new Response(null, { status: httpStatus.contentTooLarge });
	}
	const registration = body === null ? null : toRegistration(body);
	if (registration === null) {
		return new Response(null, { status: httpStatus.badRequest });
	}
	try {
		const isRegistered: boolean = await ctx.runAction(
			internal.ssh.bootstrap.registerHostKey,
			{
				// The action validates the database ID, the token, and the native key.
				allocationId: registration.allocationId as Id<"serverAllocations">,
				token: registration.token,
				hostKey: registration.hostKey,
			},
		);
		return new Response(null, {
			status: isRegistered ? httpStatus.noContent : httpStatus.forbidden,
		});
	} catch {
		// No request body, credential, or Hetzner error enters logs or responses.
		return new Response(null, { status: httpStatus.serviceUnavailable });
	}
});
