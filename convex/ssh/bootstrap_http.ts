import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { httpStatus } from "../http_status";
import { toBootstrapTokenDigest } from "./bootstrap_state";

const maxBodyBytes = 4096;
const maxBodyChunks = 64;
const maxAllocationIdLength = 100;
const bootstrapTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const maxPort = 65_535;
const hostKeyType = "ssh-ed25519";
const hostKeyBytes = 32;
// SSH wire format: length-prefixed type followed by the 32-byte Ed25519 key.
const hostKeyPrefix = new Uint8Array([
	0,
	0,
	0,
	hostKeyType.length,
	...new TextEncoder().encode(hostKeyType),
	0,
	0,
	0,
	hostKeyBytes,
]);

async function readBody(request: Request) {
	const reader = request.body?.getReader();
	if (reader === undefined) {
		return null;
	}
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		for (let read = 0; read <= maxBodyChunks; read += 1) {
			const next = await reader.read();
			if (next.done) {
				break;
			}
			size += next.value.length;
			if (size > maxBodyBytes || read === maxBodyChunks) {
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
	const port = "port" in input ? input.port : null;
	if (
		port !== null &&
		(typeof port !== "number" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > maxPort)
	) {
		return null;
	}
	return {
		allocationId: input.allocationId,
		token: input.token,
		hostKey: input.hostKey,
		port,
	};
}

/** Accept only one canonical host-key spelling. */
function isHostKey(text: string) {
	const [type, base64, ...rest] = text.split(" ");
	if (type !== hostKeyType || base64 === undefined || rest.length > 0) {
		return false;
	}
	let decoded: string;
	try {
		decoded = atob(base64);
	} catch {
		return false;
	}
	const bytes = Uint8Array.from(decoded, (character) =>
		character.charCodeAt(0),
	);
	return (
		btoa(decoded) === base64 &&
		bytes.length === hostKeyPrefix.length + hostKeyBytes &&
		hostKeyPrefix.every((byte, index) => bytes[index] === byte)
	);
}

/** Proxy headers are trusted only as source addresses; missing source is unknown. */
function toSource(request: Request) {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		null
	);
}

export const registerSshHostKey = httpAction(async (ctx, request) => {
	const body = await readBody(request);
	if (body === "tooLarge") {
		return new Response(null, { status: httpStatus.contentTooLarge });
	}
	const registration = body === null ? null : toRegistration(body);
	if (
		registration === null ||
		!bootstrapTokenPattern.test(registration.token) ||
		!isHostKey(registration.hostKey)
	) {
		return new Response(null, { status: httpStatus.badRequest });
	}
	try {
		const isRegistered: boolean = await ctx.runMutation(
			internal.ssh.bootstrap_state.registerHostKey,
			{
				allocationId: registration.allocationId,
				bootstrapTokenDigest: await toBootstrapTokenDigest(registration.token),
				hostKey: registration.hostKey,
				port: registration.port,
				source: toSource(request),
			},
		);
		return new Response(null, {
			status: isRegistered ? httpStatus.noContent : httpStatus.forbidden,
		});
	} catch {
		// Do not expose the token, body, or internal error to the caller.
		return new Response(null, { status: httpStatus.serviceUnavailable });
	}
});
