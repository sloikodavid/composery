import { expect, test } from "bun:test";
import {
	listHetznerReplyProblems,
	listHetznerRequestProblems,
} from "./hetzner-contract";
import { toActionReply, toServerTypeReply } from "./hetzner-replies";

const ok = 200;
const notDescribed = 418;
// Any action will do; the checker cares about the shape, not which one.
const actionId = 7;
// Hetzner reads an ID here, though its description says this field is a name.
const imageId = 501;

test("a reply Hetzner could send has nothing wrong with it", async () => {
	expect(
		await listHetznerReplyProblems("GET", `actions/${actionId}`, ok, {
			action: toActionReply(actionId, "success"),
		}),
	).toEqual([]);
});

test("a missing field, a wrong type, and an invented status are all reported", async () => {
	const missing = await listHetznerReplyProblems(
		"GET",
		`actions/${actionId}`,
		ok,
		{
			action: { id: actionId, status: "success" },
		},
	);
	expect(missing.join(" ")).toContain("command is missing");

	const wrongType = await listHetznerReplyProblems("GET", "server_types", ok, {
		// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
		server_types: [{ ...toServerTypeReply("cx23", ["nbg1"]), cores: "two" }],
		meta: { pagination: {} },
	});
	expect(wrongType.join(" ")).toContain('cores is "two"');

	expect(
		await listHetznerReplyProblems("GET", "actions/7", notDescribed, {}),
	).toEqual(["Hetzner does not describe a 418 for GET /actions/{id}"]);
});

test("a request Hetzner does not describe is itself a problem", async () => {
	expect(await listHetznerReplyProblems("GET", "volumes/3", ok, {})).toEqual([
		"Hetzner does not describe GET volumes/3",
	]);
});

test("a request Hetzner would refuse is reported, and a known difference is not", async () => {
	expect(
		await listHetznerRequestProblems("GET", "servers?sort_by=name", undefined),
	).toEqual(["GET /servers asks for sort_by, which Hetzner does not read"]);

	expect(
		await listHetznerRequestProblems("POST", "servers", {
			name: "one",
			// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
			server_type: "cx23",
			image: imageId,
		}),
	).toEqual([]);

	const missing = await listHetznerRequestProblems("POST", "primary_ips", {
		name: "one",
	});
	expect(missing.join(" ")).toContain("type is missing");
});
