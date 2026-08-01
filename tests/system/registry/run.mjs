import { resolveRelease } from "../../../packages/web/convex/boxes/infra/runtimeImageRegistry.ts";

// A public, multi-platform image exercises the complete anonymous Registry V2
// walk without coupling CI to one Composery deployment or registry account.
const image = "docker.io/library/alpine:latest";
const release = await resolveRelease(image);
if (!/^docker\.io\/library\/alpine@sha256:[a-f0-9]{64}$/.test(release.image)) {
	throw new Error(`The registry resolved ${image} to ${release.image}.`);
}

console.log(
	`${image} -> ${release.image} (${release.version ?? "unlabelled"})`
);
