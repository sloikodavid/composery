import { describe, expect, it } from "vitest";
import { parseRuntimeInspection } from "./ssh";

describe("runtime inspection", () => {
	it("parses known component states and ignores untrusted extra output", () => {
		expect(
			parseRuntimeInspection(`banner from host
docker=active
outer_caddy=inactive
composery=active
disk_used_percent=91
persistence=active
caddy=missing
ide=unexpected
arbitrary=value
`)
		).toEqual({
			hostReachable: true,
			httpReachable: false,
			diskUsedPercent: 91,
			docker: "active",
			outerCaddy: "inactive",
			composery: "active",
			persistence: "active",
			caddy: "missing",
			ide: "unknown"
		});
	});

	it("returns unknown states when output is incomplete", () => {
		expect(parseRuntimeInspection("")).toEqual({
			hostReachable: true,
			httpReachable: false,
			diskUsedPercent: null,
			docker: "unknown",
			outerCaddy: "unknown",
			composery: "unknown",
			persistence: "unknown",
			caddy: "unknown",
			ide: "unknown"
		});
	});
});
