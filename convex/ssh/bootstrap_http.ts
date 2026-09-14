import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction } from "../_generated/server";

export const registerSshHost = httpAction(async (ctx, request) => {
	const reader = request.body?.getReader();
	if (!reader) return new Response(null, { status: 400 });
	let size = 0;
	const chunks: Uint8Array[] = [];
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > 4096) {
				await reader.cancel();
				return new Response(null, { status: 413 });
			}
			chunks.push(next.value);
		}
	} catch {
		return new Response(null, { status: 400 });
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	let input: unknown;
	try {
		input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return new Response(null, { status: 400 });
	}
	if (
		!input ||
		typeof input !== "object" ||
		!("allocationId" in input) ||
		typeof input.allocationId !== "string" ||
		input.allocationId.length > 100 ||
		!("token" in input) ||
		typeof input.token !== "string" ||
		!("hostKey" in input) ||
		typeof input.hostKey !== "string"
	)
		return new Response(null, { status: 400 });
	try {
		const accepted: boolean = await ctx.runAction(
			internal.ssh.bootstrap.registerHostKey,
			{
				// The registered function validates the database ID, token, and native key.
				allocationId: input.allocationId as Id<"serverAllocations">,
				token: input.token,
				hostKey: input.hostKey,
			},
		);
		return new Response(null, { status: accepted ? 204 : 403 });
	} catch {
		// No request body, credentials, or provider errors enter logs or responses.
		return new Response(null, { status: 503 });
	}
});
