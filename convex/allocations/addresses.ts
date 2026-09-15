const ipv6Groups = 8;
const ipv6GroupBits = 16;
const ipv6Bits = ipv6Groups * ipv6GroupBits;
const ipv4Bits = 32;
const ipv4Octets = 4;
const octetBits = 8;
const maxOctet = 255;
const decimal = 10;
const hexadecimal = 16;
const groupPattern = /^[0-9a-fA-F]{1,4}$/;
const octetPattern = /^\d{1,3}$/;
const prefixPattern = /^\d{1,3}$/;

type Address = Readonly<{ value: bigint; bits: number }>;

function toIpv4(text: string): bigint | null {
	const octets = text.split(".");
	if (octets.length !== ipv4Octets) {
		return null;
	}
	let value = 0n;
	for (const octet of octets) {
		const number = Number(octet);
		// A leading zero means something else to some resolvers, so it is not an address here.
		if (
			!octetPattern.test(octet) ||
			number > maxOctet ||
			String(number) !== octet
		) {
			return null;
		}
		value = (value << BigInt(octetBits)) + BigInt(number);
	}
	return value;
}

/** A dotted quad may end an IPv6 address, where it fills the last two groups. */
function toGroups(parts: readonly string[]): string[] | null {
	const last = parts.at(-1);
	if (last === undefined || !last.includes(".")) {
		return [...parts];
	}
	const quad = toIpv4(last);
	return quad === null
		? null
		: [
				...parts.slice(0, -1),
				(quad >> BigInt(ipv6GroupBits)).toString(hexadecimal),
				(quad & 0xffffn).toString(hexadecimal),
			];
}

/** The eight groups an address states, with "::" standing for the zeroes between them. */
function toIpv6Groups(text: string): string[] | null {
	const halves = text.split("::");
	if (halves.length > 2 || text.includes(":::")) {
		return null;
	}
	const split = (part: string) => (part === "" ? [] : part.split(":"));
	const isCompressed = halves.length === 2;
	const head = isCompressed
		? split(halves[0] ?? "")
		: toGroups(split(halves[0] ?? ""));
	const tail = isCompressed ? toGroups(split(halves[1] ?? "")) : [];
	if (head === null || tail === null) {
		return null;
	}
	const filled = ipv6Groups - head.length - tail.length;
	// "::" must stand for at least one group, and a full address needs exactly eight.
	if (isCompressed ? filled < 1 : filled !== 0) {
		return null;
	}
	return [
		...head,
		...Array.from({ length: isCompressed ? filled : 0 }, () => "0"),
		...tail,
	];
}

function toIpv6(text: string): bigint | null {
	const groups = toIpv6Groups(text);
	if (groups === null) {
		return null;
	}
	let value = 0n;
	for (const group of groups) {
		if (!groupPattern.test(group)) {
			return null;
		}
		value = (value << BigInt(ipv6GroupBits)) + BigInt(`0x${group}`);
	}
	return value;
}

function toAddress(text: string, bits: number): Address | null {
	const value = bits === ipv4Bits ? toIpv4(text) : toIpv6(text);
	return value === null ? null : { value, bits };
}

function parse(text: string): Address | null {
	return text.includes(":")
		? toAddress(text, ipv6Bits)
		: toAddress(text, ipv4Bits);
}

function parseNetwork(text: string): (Address & { prefix: number }) | null {
	const parts = text.split("/");
	if (parts.length > 2) {
		return null;
	}
	const address = parse(parts[0] ?? "");
	if (address === null) {
		return null;
	}
	if (parts.length === 1) {
		return { ...address, prefix: address.bits };
	}
	const written = parts[1] ?? "";
	const prefix = Number.parseInt(written, decimal);
	return prefixPattern.test(written) && prefix >= 0 && prefix <= address.bits
		? { ...address, prefix }
		: null;
}

/**
 * Whether one address lies inside a network, which a plain address states as itself. Both must be
 * of the same family: a backend states an IPv4 assignment as one address, and an IPv6 one as the
 * range it gave the server, any address of which is that server.
 */
export function isAddressInNetwork(source: string, network: string) {
	const address = parse(source);
	const range = parseNetwork(network);
	if (address === null || range === null || address.bits !== range.bits) {
		return false;
	}
	const mask =
		range.prefix === 0
			? 0n
			: ((1n << BigInt(range.prefix)) - 1n) <<
				BigInt(range.bits - range.prefix);
	return (address.value & mask) === (range.value & mask);
}

/**
 * Whether an address belongs to one allocation. Null when the allocation has no address yet, so a
 * caller can refuse rather than treat an unknown as a match.
 */
export function isAllocationAddress(
	source: string,
	allocation: Readonly<{ ipv4?: string; ipv6?: string }>,
) {
	const networks = [allocation.ipv4, allocation.ipv6].filter(
		(network): network is string => network !== undefined,
	);
	return networks.length === 0
		? null
		: networks.some((network) => isAddressInNetwork(source, network));
}
