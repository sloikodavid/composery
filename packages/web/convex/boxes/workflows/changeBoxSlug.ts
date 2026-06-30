import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { workflow } from "./boxWorkflow";

export const changeBoxSlug = workflow.define({
	args: {
		boxId: v.id("boxes"),
		newSlug: v.string(),
		operationId: v.id("box_operations")
	},
	handler: async (step, args) => {
		await step.runMutation(internal.boxes.boxStatus.markOperationRunning, {
			operationId: args.operationId
		});

		const box = await step.runQuery(
			internal.boxes.boxQueries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		let dns: { aRecordId: string; aaaaRecordId: string } | null = null;

		try {
			if (!box.hetzner_ipv4 || !box.hetzner_ipv6) {
				throw new Error("Box does not have both public IP addresses.");
			}

			dns = await step.runAction(
				internal.boxes.infra.cloudflareDns.createRuntimeDnsRecords,
				{
					slug: args.newSlug,
					ipv4: box.hetzner_ipv4,
					ipv6: box.hetzner_ipv6
				},
				{ retry: true }
			);

			if (!dns) throw new Error("DNS records were not created.");

			await step.runAction(
				internal.boxes.infra.ssh.reloadSlug,
				{
					boxId: args.boxId,
					newSlug: args.newSlug
				},
				{ retry: true }
			);

			await step.runMutation(internal.boxes.boxStatus.swapSlug, {
				boxId: args.boxId,
				operationId: args.operationId,
				newSlug: args.newSlug,
				newARecordId: dns.aRecordId,
				newAaaaRecordId: dns.aaaaRecordId
			});

			try {
				await step.runAction(
					internal.boxes.infra.cloudflareDns.deleteRuntimeDnsRecords,
					{
						aRecordId: box.dns_record_id,
						aaaaRecordId: box.dns_record_aaaa_id
					},
					{ retry: true }
				);
			} catch {
				// Old DNS cleanup is best-effort after the slug swap has committed.
			}
		} catch (error) {
			if (dns) {
				await step
					.runAction(
						internal.boxes.infra.ssh.reloadSlug,
						{
							boxId: args.boxId,
							newSlug: box.slug
						},
						{ retry: true }
					)
					.catch(() => undefined);
				await step
					.runAction(
						internal.boxes.infra.cloudflareDns.deleteRuntimeDnsRecords,
						{
							aRecordId: dns.aRecordId,
							aaaaRecordId: dns.aaaaRecordId
						},
						{ retry: true }
					)
					.catch(() => undefined);
			}
			await step.runMutation(internal.boxes.boxStatus.markOperationFailed, {
				boxId: args.boxId,
				operationId: args.operationId,
				error: error instanceof Error ? error.message : String(error),
				eventType: "box.slug_change_failed",
				targetBoxStatus: "running"
			});
			throw error;
		}
	}
});
