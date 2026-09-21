import { afterEach, expect, test } from "bun:test";
import { getHetznerToken } from "../../../harness/hetzner/real";

const namesTheToken = /HCLOUD_TOKEN/;
const held = {
	mode: process.env.HCLOUD_MODE,
	token: process.env.HCLOUD_TOKEN,
};
const localServerId = 11;
const firstPage = 1;
const secondPage = 2;
const nonProgressingPattern = /non-progressing/;
const wrongPagePattern = /wrong .* cleanup page/;

function set(name: "HCLOUD_MODE" | "HCLOUD_TOKEN", value: string | undefined) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

afterEach(() => {
	set("HCLOUD_MODE", held.mode);
	set("HCLOUD_TOKEN", held.token);
});

test("keeps the fake a fake while the token sits in the file", () => {
	// Credentials alone must not select a real provider project.
	set("HCLOUD_MODE", "fake");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("keeps the fake a fake when nothing said which to use", () => {
	set("HCLOUD_MODE", undefined);
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("refuses a run that asked for the real Hetzner with no token", () => {
	// Never fall back to fake after an explicit real-mode request.
	set("HCLOUD_MODE", "real");
	set("HCLOUD_TOKEN", "");

	expect(() => getHetznerToken()).toThrow(namesTheToken);
});

test("hands a run that asked for it the token it was given", () => {
	set("HCLOUD_MODE", "real");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe("not-a-token");
});

function page(pageNumber: number, nextPage: number | null, servers: unknown[]) {
	return {
		servers,
		meta: {
			pagination: {
				page: pageNumber,
				// biome-ignore lint/style/useNamingConvention: Hetzner's API uses snake_case
				next_page: nextPage,
			},
		},
	};
}

test("cleanup reads every Hetzner page and validates rows", async () => {
	const { removeHetznerLeftovers } = await import(
		"../../../harness/hetzner/real"
	);
	const controllerId = "test-local-run";
	const deleted = new Set<number>();
	const paths: string[] = [];
	const request = (_token: string, method: string, path: string) => {
		const url = new URL(path, "https://local.test");
		paths.push(`${url.pathname}${url.search}`);
		if (method === "DELETE") {
			deleted.add(Number(url.pathname.split("/").at(-1)));
			return Promise.resolve({ status: 204, body: null });
		}
		const requestedPage = Number(url.searchParams.get("page"));
		if (requestedPage === firstPage) {
			return Promise.resolve({
				status: 200,
				body: page(
					firstPage,
					deleted.has(localServerId) ? null : secondPage,
					deleted.has(localServerId)
						? []
						: [
								{
									id: 11,
									created: new Date().toISOString(),
									labels: { "controller-id": controllerId },
								},
							],
				),
			});
		}
		if (requestedPage === secondPage) {
			return Promise.resolve({
				status: 200,
				body: page(
					secondPage,
					null,
					deleted.has(localServerId)
						? []
						: [
								{
									id: 12,
									created: new Date().toISOString(),
									labels: { "controller-id": "other" },
								},
							],
				),
			});
		}
		throw new Error(`Unexpected page ${requestedPage}`);
	};
	await removeHetznerLeftovers(
		"token_local",
		controllerId,
		["servers"],
		request,
	);

	expect(paths).toContain("/servers?per_page=50&page=2");
	expect(deleted).toEqual(new Set([localServerId]));
});

test("cleanup rejects malformed or non-progressing Hetzner pagination", async () => {
	const { removeHetznerLeftovers } = await import(
		"../../../harness/hetzner/real"
	);
	const request = (_token: string, _method: string, path: string) => {
		const url = new URL(path, "https://local.test");
		const requestedPage = Number(url.searchParams.get("page"));
		return Promise.resolve({
			status: 200,
			body:
				requestedPage === firstPage
					? {
							servers: [
								{
									id: localServerId,
									created: new Date().toISOString(),
									labels: { "controller-id": "test-local-run" },
								},
							],
							meta: {
								pagination: {
									page: firstPage,
									// biome-ignore lint/style/useNamingConvention: Hetzner's API uses snake_case
									next_page: firstPage,
								},
							},
						}
					: page(requestedPage, null, []),
		});
	};
	await expect(
		removeHetznerLeftovers(
			"token_local",
			"test-local-run",
			["servers"],
			request,
		),
	).rejects.toThrow(nonProgressingPattern);

	const malformedRequest = () =>
		Promise.resolve({
			status: 200,
			body: { servers: [], meta: { pagination: {} } },
		});
	await expect(
		removeHetznerLeftovers(
			"token_local",
			"test-local-run",
			["servers"],
			malformedRequest,
		),
	).rejects.toThrow(wrongPagePattern);
});
