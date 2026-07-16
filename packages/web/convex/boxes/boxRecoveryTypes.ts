import { v, type Infer } from "convex/values";

export const vRecoveryType = v.union(
	v.literal("restart_services"),
	v.literal("recreate_containers"),
	v.literal("restore_runtime"),
	v.literal("reboot_server")
);

export type RecoveryType = Infer<typeof vRecoveryType>;

export const vRuntimeComponentState = v.union(
	v.literal("active"),
	v.literal("inactive"),
	v.literal("missing"),
	v.literal("unknown")
);

export const vRecoveryStatus = v.object({
	hostReachable: v.boolean(),
	httpReachable: v.boolean(),
	diskUsedPercent: v.union(v.number(), v.null()),
	docker: vRuntimeComponentState,
	outerCaddy: vRuntimeComponentState,
	composery: vRuntimeComponentState,
	persistence: vRuntimeComponentState,
	caddy: vRuntimeComponentState,
	ide: vRuntimeComponentState
});

export type RecoveryStatus = Infer<typeof vRecoveryStatus>;
