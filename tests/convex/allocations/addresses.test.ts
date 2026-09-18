import { expect, test } from "bun:test";
import {
	isAddressInNetwork,
	isAllocationAddress,
	toReportedAddress,
} from "../../../convex/allocations/addresses";

const network = "2a01:4f8:1c1c:328::/64";

test("accepts every address of the network a server was given", () => {
	for (const source of [
		"2a01:4f8:1c1c:328::1",
		"2a01:4f8:1c1c:328:0:0:0:1",
		"2a01:4f8:1c1c:328:ffff:ffff:ffff:ffff",
		"2a01:04f8:1c1c:0328::1",
		"2A01:4F8:1C1C:328::1",
		"2a01:4f8:1c1c:328::192.0.2.1",
	]) {
		expect(isAddressInNetwork(source, network)).toBe(true);
	}
});

test("refuses an address outside the network, including a neighbouring one", () => {
	for (const source of [
		"2a01:4f8:1c1c:329::1",
		"2a01:4f8:1c1c:327:ffff:ffff:ffff:ffff",
		"::1",
		"192.0.2.1",
	]) {
		expect(isAddressInNetwork(source, network)).toBe(false);
	}
});

test("refuses malformed input rather than reading past the damage", () => {
	const malformed = [
		"2001:db8::1::2",
		"2001:db8:::1",
		"1:2:3:4:5:6:7:8::9",
		"1:2:3:4:5:6:7:8:9",
		"2001:db8::1 ",
		"2001:db8::g",
		"2001:db8::12345",
		"",
		"::192.0.2.256",
		"::192.0.2.01",
	];
	for (const source of malformed) {
		expect(isAddressInNetwork(source, network)).toBe(false);
		expect(isAddressInNetwork("2a01:4f8:1c1c:328::1", source)).toBe(false);
	}
});

test("refuses a network whose prefix is not a plain length", () => {
	for (const written of [
		"2001:db8::/64/64",
		"2001:db8::/0x40",
		"2001:db8::/-1",
		"2001:db8::/129",
		"2001:db8::/",
		"2001:db8::/ 64",
	]) {
		expect(isAddressInNetwork("2001:db8::1", written)).toBe(false);
	}
});

test("reads the edges of a prefix", () => {
	expect(isAddressInNetwork("2001:db8::1", "::/0")).toBe(true);
	expect(isAddressInNetwork("192.0.2.9", "0.0.0.0/0")).toBe(true);
	expect(isAddressInNetwork("2001:db8::1", "2001:db8::1/128")).toBe(true);
	expect(isAddressInNetwork("2001:db8::2", "2001:db8::1/128")).toBe(false);
	expect(isAddressInNetwork("192.0.2.9", "192.0.2.8/31")).toBe(true);
	expect(isAddressInNetwork("192.0.2.10", "192.0.2.8/31")).toBe(false);
});

test("never mixes the two families", () => {
	expect(isAddressInNetwork("192.0.2.1", "::ffff:192.0.2.1/128")).toBe(false);
	expect(isAddressInNetwork("::ffff:192.0.2.1", "192.0.2.1")).toBe(false);
});

test("says it cannot tell when an allocation has no address yet", () => {
	expect(isAllocationAddress("192.0.2.1", {})).toBe(null);
	expect(isAllocationAddress("192.0.2.1", { ipv4: "192.0.2.1" })).toBe(true);
	expect(isAllocationAddress("192.0.2.2", { ipv4: "192.0.2.1" })).toBe(false);
	expect(isAllocationAddress("2a01:4f8:1c1c:328::1", { ipv6: network })).toBe(
		true,
	);
});

test("shows only an address the server has been seen using", () => {
	// The range is what the provider gave; which address inside it answers is set in the server.
	expect(toReportedAddress(network, undefined)).toBe(null);
	expect(toReportedAddress(network, network)).toBe(null);
	expect(toReportedAddress(network, "2a01:4f8:1c1c:328::1")).toBe(
		"2a01:4f8:1c1c:328::1",
	);
	// A server that reached us over IPv4 has said nothing about which IPv6 address it answers on.
	expect(toReportedAddress(network, "192.0.2.1")).toBe(null);
	expect(toReportedAddress(undefined, "2a01:4f8:1c1c:328::1")).toBe(null);
	// An IPv4 assignment is one address, and the server reporting from it says the same thing.
	expect(toReportedAddress("192.0.2.1", "192.0.2.1")).toBe("192.0.2.1");
	expect(toReportedAddress("192.0.2.1", "192.0.2.2")).toBe(null);
});
