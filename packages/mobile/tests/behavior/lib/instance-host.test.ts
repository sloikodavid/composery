import { afterEach, describe, expect, test } from "vitest";

import {
	clearActiveInstance,
	getActiveInstanceId,
	setActiveInstance
} from "@/lib/instance-host";

afterEach(() => setActiveInstance(null));

describe("active instance ownership", () => {
	test("an old route cleanup cannot clear the newly focused route", () => {
		setActiveInstance("old");
		setActiveInstance("new");

		clearActiveInstance("old");

		expect(getActiveInstanceId()).toBe("new");
	});

	test("the route that owns focus can clear itself", () => {
		setActiveInstance("current");

		clearActiveInstance("current");

		expect(getActiveInstanceId()).toBeNull();
	});
});
