import { describe, expect, test } from "vitest";

import { readRepoFile } from "./support/patchSource.ts";

// The tagline is the first sentence a reader gets, and it is written down in
// several places. Some of them import it; README.md, docs/index.md and the
// Dockerfile cannot, so shared says of itself that such files "duplicate these values
// by hand". A hand copy nothing checks is a hand copy that drifts - this is the
// check that makes the sentence in shared the one that actually ships.
describe("brand copy", () => {
	const tagline = /APP_TAGLINE =\s*"([^"]+)"/.exec(
		readRepoFile("packages/shared/index.ts")
	)?.[1];

	test("shared declares a tagline to pin the copies to", () => {
		expect(tagline).toEqual(expect.any(String));
	});

	test.each([
		// The README opens on it, under the title.
		["README.md", (copy: string) => copy],
		// Fumadocs frontmatter, which reads as a sentence about the product.
		["docs/index.md", (copy: string) => `Composery is ${lowerFirst(copy)}`],
		// The OCI image description registries show next to the image.
		[
			"Dockerfile",
			(copy: string) => `org.opencontainers.image.description="${copy}"`
		]
	])("%s carries the tagline shared declares", (file, phrase) => {
		expect(readRepoFile(file)).toContain(phrase(tagline!));
	});
});

// "A secure cloud..." -> "a secure cloud...", so the docs sentence reads as one.
function lowerFirst(value: string): string {
	return value.charAt(0).toLowerCase() + value.slice(1);
}
