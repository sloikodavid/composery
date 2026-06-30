import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

// Delete the box's DNS and server, waiting for Hetzner to finish, so the server
// name/labels are free to reuse. Shared by resetBox and deleteBox.
export async function deleteRuntime(step: WorkflowCtx, box: Doc<"boxes">) {
	await step.runAction(
		internal.boxes.infra.cloudflareDns.deleteRuntimeDnsRecords,
		{
			aRecordId: box.dns_record_id,
			aaaaRecordId: box.dns_record_aaaa_id
		},
		{ retry: true }
	);
	await step.runAction(
		internal.boxes.infra.hetznerVps.deleteServer,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);
	await step.runAction(
		internal.boxes.infra.hetznerVps.waitServerDeleted,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);
	await step.runAction(
		internal.boxes.infra.hetznerVps.deletePrimaryIps,
		{
			ipv4: box.hetzner_ipv4,
			ipv4Id: box.hetzner_ipv4_id,
			ipv6: box.hetzner_ipv6,
			ipv6Id: box.hetzner_ipv6_id
		},
		{ retry: true }
	);
}

// Create a server and DNS, then bootstrap the runtime, recording each step.
// Shared by provisionBox and resetBox.
export async function createRuntime(
	step: WorkflowCtx,
	boxId: Id<"boxes">,
	slug: string
) {
	const server = await step.runAction(
		internal.boxes.infra.hetznerVps.createServer,
		{ boxId, slug },
		{ retry: true }
	);

	await step.runMutation(internal.boxes.boxStatus.recordServerCreated, {
		boxId,
		serverId: server.serverId,
		serverType: server.serverType,
		location: server.location,
		ipv4: server.ipv4,
		ipv4Id: server.ipv4Id,
		ipv6: server.ipv6,
		ipv6Id: server.ipv6Id
	});

	const dns = await step.runAction(
		internal.boxes.infra.cloudflareDns.createRuntimeDnsRecords,
		{ slug, ipv4: server.ipv4, ipv6: server.ipv6 },
		{ retry: true }
	);

	await step.runMutation(internal.boxes.boxStatus.recordDnsCreated, {
		boxId,
		aRecordId: dns.aRecordId,
		aaaaRecordId: dns.aaaaRecordId
	});

	await step.runAction(
		internal.boxes.infra.ssh.bootstrapRuntime,
		{ boxId },
		{ retry: true }
	);
}

// Rebuild the existing VPS disk from the base image, preserving the server and
// Primary IP resources while still removing any host-level damage.
export async function rebuildRuntime(step: WorkflowCtx, box: Doc<"boxes">) {
	const runtimeImage = await step.runAction(
		internal.boxes.infra.runtimeImages.resolveConfiguredRuntimeImage,
		{},
		{ retry: true }
	);

	await step.runMutation(internal.boxes.boxStatus.setRuntimeImage, {
		boxId: box._id,
		runtimeImage
	});

	const server = await step.runAction(
		internal.boxes.infra.hetznerVps.rebuildServer,
		{ serverId: box.hetzner_server_id },
		{ retry: true }
	);

	await step.runMutation(internal.boxes.boxStatus.recordServerRebuilt, {
		boxId: box._id,
		serverId: server.serverId,
		serverType: server.serverType,
		location: server.location,
		ipv4: server.ipv4,
		ipv4Id: server.ipv4Id,
		ipv6: server.ipv6,
		ipv6Id: server.ipv6Id
	});

	await step.runAction(
		internal.boxes.infra.ssh.bootstrapRuntime,
		{ boxId: box._id },
		{ retry: true }
	);
}
