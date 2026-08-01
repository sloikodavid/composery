import { resolveRelease } from "../../../packages/web/convex/boxes/infra/runtimeImageRegistry.ts";

// This is the image every self-hosting guide and managed box uses. Resolve it
// without credentials so a deleted or private release fails before deployment.
const image = "ghcr.io/sloikodavid/composery:latest";
const release = await resolveRelease(image);
if (
	!/^ghcr\.io\/sloikodavid\/composery@sha256:[a-f0-9]{64}$/.test(release.image)
) {
	throw new Error(`The registry resolved ${image} to ${release.image}.`);
}
if (release.version !== "0.1.0") {
	throw new Error(`The registry reports version ${release.version ?? "none"}.`);
}

console.log(
	`${image} -> ${release.image} (${release.version ?? "unlabelled"})`
);
