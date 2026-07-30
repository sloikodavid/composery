import {
	array,
	boolean,
	constantFrom,
	integer,
	nat,
	option,
	record
} from "fast-check";

const URL_CHARACTER = [
	..."abcdefghijklmnopqrstuvwxyz",
	..."0123456789",
	"-",
	"_"
] as const;

const urlPart = array(constantFrom(...URL_CHARACTER), {
	minLength: 1,
	maxLength: 16
}).map((characters) => characters.join(""));

// Public HTTPS inputs exercise path, query, fragment, port, and host
// canonicalization without generating cleartext URLs that the product correctly
// rejects. Both URL behavior suites use this one generator so their idea of a
// round-trippable instance cannot drift.
export const instanceUrlArbitrary = record({
	folder: option(urlPart, { nil: undefined }),
	fragment: option(urlPart, { nil: undefined }),
	hostId: nat(1_000_000),
	path: array(urlPart, { maxLength: 4 }),
	port: option(integer({ min: 1_024, max: 65_535 }), {
		nil: undefined
	}),
	trailingSlash: boolean()
}).map(({ folder, fragment, hostId, path, port, trailingSlash }) => {
	const authority = `box-${hostId}.example${port ? `:${port}` : ""}`;
	const pathname =
		path.length === 0 ? "/" : `/${path.join("/")}${trailingSlash ? "/" : ""}`;
	const url = new URL(`https://${authority}${pathname}`);
	if (folder !== undefined) url.searchParams.set("folder", `/${folder}`);
	if (fragment !== undefined) url.hash = fragment;
	return url.href;
});
