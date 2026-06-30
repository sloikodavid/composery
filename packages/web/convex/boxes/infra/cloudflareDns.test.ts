import { describe, expect, it } from "vitest";
import { dnsRecordListPath, dnsRecordPayload } from "./cloudflareDns";

describe("dns request contracts", () => {
	it("uses exact Cloudflare DNS lookups before create or update", () => {
		const path = dnsRecordListPath("zone-123", "AAAA", "my-box.example.com");
		const query = new URLSearchParams(path.split("?")[1]);

		expect(path.startsWith("/zones/zone-123/dns_records?")).toBe(true);
		expect(query.get("match")).toBe("all");
		expect(query.get("name.exact")).toBe("my-box.example.com");
		expect(query.get("per_page")).toBe("100");
		expect(query.get("type")).toBe("AAAA");
	});

	it("keeps runtime DNS records DNS-only and auto-TTL", () => {
		expect(dnsRecordPayload("A", "my-box.example.com", "203.0.113.10")).toEqual(
			{
				type: "A",
				name: "my-box.example.com",
				content: "203.0.113.10",
				ttl: 1,
				proxied: false
			}
		);
	});
});
