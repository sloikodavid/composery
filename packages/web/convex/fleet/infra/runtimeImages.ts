import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { requiredEnv } from "../../env";
import { resolveRelease, type RuntimeRelease } from "./runtimeImageRegistry";

export {
	parseImageReference,
	pickLinuxManifest,
	registryTokenUrl,
	resolveRelease,
	runtimeImageManifestUrl,
	type ParsedImageReference,
	type RuntimeRelease
} from "./runtimeImageRegistry";

const vRuntimeReleaseResult = v.object({
	image: v.string(),
	version: v.union(v.string(), v.null())
});

export const resolveRuntimeRelease = internalAction({
	args: { image: v.string() },
	returns: vRuntimeReleaseResult,
	handler: async (_ctx, args): Promise<RuntimeRelease> =>
		await resolveRelease(args.image)
});

export const resolveConfiguredRuntimeRelease = internalAction({
	args: {},
	returns: vRuntimeReleaseResult,
	handler: async (): Promise<RuntimeRelease> =>
		await resolveRelease(requiredEnv("RUNTIME_IMAGE"))
});
