import { describe, expect, test } from "vitest";

import { readRepoFile } from "../../../../tests/support/repo.ts";
import { addedLines } from "../support/patch.ts";

const rawPatch = readRepoFile("packages/ide/patches/narrow.diff");
const patch = addedLines(rawPatch);

describe("narrow layout reconciliation", () => {
	test("follows recurring workbench layout instead of a one-shot media-query signal", () => {
		expect(rawPatch).toMatch(
			/this\.handleContainerDidLayout\(this\.mainContainer, this\._mainContainerDimension\);[\s\S]{0,600}this\.narrowPart \?\?= Layout\.NARROW_PARTS\.find\(part => this\.isVisible\(part\)\);\r?\n\+\s*this\.scheduleNarrowLayout\(\);/
		);
		expect(patch).not.toContain("matchMedia(NARROW_QUERY)");
		expect(patch).not.toContain("private narrowLayoutInitialized");
	});

	test("reconciles again after upstream finishes restoring every workbench part", () => {
		expect(patch).toContain(
			"this.whenReady.finally(() => this.scheduleNarrowLayout());"
		);
	});
});
