"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import {
	createHetznerCloudFirewall,
	findHetznerCloudFirewall,
	getHetznerCloudConfig,
	setHetznerCloudFirewallRules,
} from "./api";
import { isFirewallAsStated } from "./firewall";

const settleTimeoutMs = 60_000;
const settleDelayMs = 1000;

/**
 * Reads the firewall back until it allows what Composery states. Hetzner answers a request to set
 * rules before it has carried it out, so the answer is not the outcome: this says the rules are
 * back only once the provider says the same thing.
 */
async function requireRulesAsStated(controllerId: string) {
	const deadline = Date.now() + settleTimeoutMs;
	while (Date.now() < deadline) {
		const found = await findHetznerCloudFirewall(controllerId);
		if (found !== null && isFirewallAsStated(found.rules)) {
			return;
		}
		await new Promise((wake) => setTimeout(wake, settleDelayMs));
	}
	throw new Error("Hetzner did not apply the firewall rules in time.");
}

/**
 * Claims a Hetzner project for this controller, which is the one thing here a person decides.
 *
 * Everything else Composery makes at a provider, it makes on its own; a firewall is not, and the
 * reason is what the firewall proves. The worker refuses to act on an allocation unless a firewall
 * carrying this controller's label is there, so a token for somebody else's project fails instead
 * of finding an empty project and reading it as "every server was deleted". A worker that made the
 * firewall itself would prove nothing, because it would have made it wherever the token pointed.
 *
 * So this is deliberate and it is run once for a deployment, by a person who has just set that
 * deployment's token. It is safe to run again: it finds what it made before, and puts the rules
 * back if they have been changed at the provider.
 */
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
		const found = await findHetznerCloudFirewall(config.controllerId);
		if (found === null) {
			return {
				firewallId: await createHetznerCloudFirewall(config.controllerId),
				did: "made" as const,
			};
		}
		if (isFirewallAsStated(found.rules)) {
			return { firewallId: found.id, did: "kept" as const };
		}
		await setHetznerCloudFirewallRules(found.id);
		await requireRulesAsStated(config.controllerId);
		return { firewallId: found.id, did: "put the rules back" as const };
	},
});
