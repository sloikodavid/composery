import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

// Must match convex/auth.config.ts.
const audience = "convex";
const keyIdBytes = 8;
const tokenLifetimeSeconds = 600;
const millisecondsPerSecond = 1000;

export type SignInIssuer = Readonly<{
	url: string;
	signIn: (subject: string) => string;
	stop: () => void;
}>;

const toBase64Url = (value: Buffer | string) =>
	Buffer.from(value).toString("base64url");

/** Loopback issuer that exercises the same discovery and key verification as Clerk. */
export function startSignInIssuer(): SignInIssuer {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const keyId = randomBytes(keyIdBytes).toString("hex");
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const { origin: issuer, pathname } = new URL(request.url);
			switch (pathname) {
				case "/.well-known/openid-configuration":
					return Response.json({
						issuer,
						// biome-ignore lint/style/useNamingConvention: external field name
						jwks_uri: `${issuer}/.well-known/jwks.json`,
					});
				case "/.well-known/jwks.json":
					return Response.json({
						keys: [
							{
								...publicKey.export({ format: "jwk" }),
								kid: keyId,
								alg: "RS256",
								use: "sig",
							},
						],
					});
				default:
					return new Response("Not found", { status: 404 });
			}
		},
	});
	const url = `http://127.0.0.1:${server.port}`;
	return {
		url,
		signIn: (subject) => {
			const issuedAt = Math.floor(Date.now() / millisecondsPerSecond);
			const header = toBase64Url(
				JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
			);
			const payload = toBase64Url(
				JSON.stringify({
					iss: url,
					aud: audience,
					sub: subject,
					iat: issuedAt,
					exp: issuedAt + tokenLifetimeSeconds,
				}),
			);
			const signature = createSign("RSA-SHA256")
				.update(`${header}.${payload}`)
				.sign(privateKey);
			return `${header}.${payload}.${toBase64Url(signature)}`;
		},
		stop: () => {
			server.stop(true);
		},
	};
}
