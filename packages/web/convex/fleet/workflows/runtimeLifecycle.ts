import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { boxPlanServerType, type BoxPlan } from "../../model/box/plan";

// Delete the box's DNS and server, waiting for Hetzner to finish, so the server
// name/labels are free to reuse. Shared by resetBox and deleteBox.
//
// The box's Primary IPs are deliberately not touched here. Hetzner creates them
// itself for a server asked for with `enable_ipv4`/`enable_ipv6` (see
// `createServerPayload`), marks them `auto_delete`, and removes them along with
// the server - asynchronously, and on its own schedule. Deleting them from here
// therefore raced Hetzner's own cleanup and lost: the step answered
// "Primary IP must be unassigned" and left the box in `delete_failed` with its
// server already gone. That was the second failure of the same step, after a
// lookup form Hetzner rejected with 422 wedged deletion in an hourly retry loop,
// so the step itself is the defect rather than either symptom.
//
// Nothing silently replaces it: `reconcileHetznerResources` reports any Primary
// IP left attached to nothing, so a leak surfaces as a staff alert instead of a
// quiet bill - and it does so off the deletion path, where being a day late
// costs nothing and failing costs a box that can never finish deleting.
export async function deleteRuntime(step: WorkflowCtx, box: Doc<"boxes">) {
	await step.runAction(
		internal.fleet.infra.cloudflareDns.deleteRuntimeDnsRecords,
		{
			aRecordId: box.dns_record_id,
			aaaaRecordId: box.dns_record_aaaa_id
		},
		{ retry: true }
	);
	await step.runAction(
		internal.fleet.infra.hetznerVps.deleteServer,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);
	await step.runAction(
		internal.fleet.infra.hetznerVps.waitServerDeleted,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);
}

// Create a server and DNS, then bootstrap the runtime, recording each step.
// Shared by createBox and resetBox.
export async function createRuntime(
	step: WorkflowCtx,
	boxId: Id<"boxes">,
	slug: string,
	plan: BoxPlan
) {
	const server = await step.runAction(
		internal.fleet.infra.hetznerVps.createServer,
		{ boxId, slug, serverType: boxPlanServerType(plan) },
		{ retry: true }
	);

	await step.runMutation(internal.fleet.lifecycle.recordServerCreated, {
		boxId,
		serverId: server.serverId,
		serverType: server.serverType,
		location: server.location,
		ipv4: server.ipv4,
		ipv6: server.ipv6
	});

	const dns = await step.runAction(
		internal.fleet.infra.cloudflareDns.createRuntimeDnsRecords,
		{ slug, ipv4: server.ipv4, ipv6: server.ipv6 },
		{ retry: true }
	);

	await step.runMutation(internal.fleet.lifecycle.recordDnsCreated, {
		boxId,
		aRecordId: dns.aRecordId,
		aaaaRecordId: dns.aaaaRecordId
	});

	await step.runAction(
		internal.fleet.infra.ssh.bootstrapRuntime,
		{ boxId },
		{ retry: true }
	);
}

// Rebuild the existing VPS disk from the base image, preserving the server and
// Primary IP resources while still removing any host-level damage.
export async function rebuildRuntime(step: WorkflowCtx, box: Doc<"boxes">) {
	const release = await step.runAction(
		internal.fleet.infra.runtimeImages.resolveConfiguredRuntimeRelease,
		{},
		{ retry: true }
	);

	await step.runMutation(internal.fleet.lifecycle.setRuntimeImage, {
		boxId: box._id,
		runtimeImage: release.image,
		runtimeVersion: release.version
	});

	const server = await step.runAction(
		internal.fleet.infra.hetznerVps.rebuildServer,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);

	await step.runMutation(internal.fleet.lifecycle.recordServerRebuilt, {
		boxId: box._id,
		serverId: server.serverId,
		serverType: server.serverType,
		location: server.location,
		ipv4: server.ipv4,
		ipv6: server.ipv6
	});

	await step.runAction(
		internal.fleet.infra.ssh.bootstrapRuntime,
		{ boxId: box._id },
		{ retry: true }
	);
}
