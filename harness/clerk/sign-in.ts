import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

// Matches the application ID that convex/auth.config.ts expects in every token.
const audience = "convex";
const keyIdBytes = 8;
const tokenLifetimeSeconds = 600;
const millisecondsPerSecond = 1000;

export type SignInIssuer = Readonly<{
	/** The issuer's address, which the deployment reads as CLERK_FRONTEND_API_URL. */
	url: string;
	/** A token that the deployment accepts as a sign-in by this subject, a Clerk user ID. */
	signIn: (subject: string) => string;
	stop: () => void;
}>;

const toBase64Url = (value: Buffer | string) =>
	Buffer.from(value).toString("base64url");

/**
 * An OpenID issuer on a loopback port that stands in for Clerk. The deployment fetches its
 * configuration and signing keys exactly as it does Clerk's, so a signed-in test takes the same
 * verification path as a signed-in person.
 */
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
						// biome-ignore lint/style/useNamingConvention: OpenID Connect Discovery names this field
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
