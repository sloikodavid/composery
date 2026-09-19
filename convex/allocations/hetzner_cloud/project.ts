"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import {
	createHetznerCloudFirewall,
	createHetznerCloudUsage,
	findHetznerCloudFirewall,
	getHetznerCloudConfig,
	setHetznerCloudFirewallRules,
} from "./api";
import { isFirewallAsStated } from "./firewall";
import type { HetznerCloudUsage } from "./pacing";

const settleTimeoutMs = 60_000;
const settleDelayMs = 1000;

/** Provider actions are asynchronous; return only after effective rules match. */
async function requireRulesAsStated(
	usage: HetznerCloudUsage,
	controllerId: string,
) {
	const deadline = Date.now() + settleTimeoutMs;
	while (Date.now() < deadline) {
		const found = await findHetznerCloudFirewall(usage, controllerId);
		if (found !== null && isFirewallAsStated(found.rules)) {
			return;
		}
		await new Promise((wake) => setTimeout(wake, settleDelayMs));
	}
	throw new Error("Hetzner did not apply the firewall rules in time.");
}

/** Claims the labeled firewall that proves this token points at the configured project. */
export const claimFirewall = internalAction({
	args: {},
	returns: v.object({
		firewallId: v.number(),
		did: v.union(
			v.literal("made"),
			v.literal("kept"),
			v.literal("put the rules back"),
		),
	}),
	handler: async () => {
		const config = getHetznerCloudConfig();
		if (config === null) {
			throw new Error(
				"This deployment has no Hetzner Cloud configuration to claim a project with.",
			);
		}
		const usage = createHetznerCloudUsage();
		const found = await findHetznerCloudFirewall(usage, config.controllerId);
		if (found === null) {
			return {
				firewallId: await createHetznerCloudFirewall(
					usage,
					config.controllerId,
				),
				did: "made" as const,
			};
		}
		if (isFirewallAsStated(found.rules)) {
			return { firewallId: found.id, did: "kept" as const };
		}
		await setHetznerCloudFirewallRules(usage, found.id);
		await requireRulesAsStated(usage, config.controllerId);
		return { firewallId: found.id, did: "put the rules back" as const };
	},
});
