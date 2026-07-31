// The one `.yml` left, and the only one that is not a repository file: this is a
// path on a box that is already running. Every box provisioned so far has the
// file under this name, and repair reads it (`compose config --volumes`) before
// anything rewrites it - so renaming it here to match the repository's `.yaml`
// would make repair fail on exactly the boxes that need repairing. It moves when
// something migrates the existing fleet, not when the checkout is tidied.
export const COMPOSERY_COMPOSE_PATH = "/opt/composery-web/compose.yml";
export const COMPOSERY_ENV_PATH = "/opt/composery-web/composery.env";
export const COMPOSERY_CADDYFILE_PATH = "/opt/composery-web/Caddyfile";
// renovate: datasource=docker depName=caddy
export const CADDY_IMAGE =
	"caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";

export type RuntimeArtifacts = {
	caddyfile: string;
	compose: string;
	env: string;
};

export function renderCaddyfile(domain: string, runtimePort: number) {
	return `${domain} {
\tencode gzip
\treverse_proxy composery:${runtimePort}
}
`;
}

// The box's env file: the three variables the website manages, then whatever the
// owner has configured.
//
// `config` is written last but can never shadow a managed variable, because
// `normalizeRuntimeConfig` only admits keys on its allowlist and none of the
// three below are on it. The ordering is therefore presentational, not a
// precedence mechanism - do not turn it into one.
//
// This function is the reason a saved configuration survives the box's
// lifecycle. Every path that rewrites the env file goes through here from the
// box row: bootstrap, repair, reset, an update, and a password change. If the
// owner's variables were held anywhere but the row - passed once at save time
// and not stored - the next Reset or Repair would render an env file without
// them and quietly revert every setting the owner had made.
export function renderComposeryEnv({
	cloudBoxId,
	cloudOrigin,
	config,
	runtimeAuthHash,
	runtimeImage
}: {
	cloudBoxId?: string;
	cloudOrigin?: string;
	config?: Readonly<Record<string, string>>;
	runtimeAuthHash?: string;
	runtimeImage?: string;
}) {
	if (Boolean(cloudBoxId) !== Boolean(cloudOrigin)) {
		throw new Error("Cloud box id and origin must be configured together.");
	}

	const managed = [
		runtimeAuthHash
			? `COMPOSERY_HASHED_PASSWORD=${quoteEnvFileValue(runtimeAuthHash)}`
			: undefined,
		cloudBoxId
			? `COMPOSERY_CLOUD_BOX_ID=${quoteEnvFileValue(cloudBoxId)}`
			: undefined,
		cloudOrigin
			? `COMPOSERY_CLOUD_ORIGIN=${quoteEnvFileValue(cloudOrigin)}`
			: undefined,
		// The digest this container was started as, told to the box rather than
		// derived by it.
		//
		// An image cannot contain its own digest: the digest is the hash of the
		// manifest, which covers the config holding the image's own environment and
		// labels, so writing the answer in changes it. That fixed point is why the
		// build can only stamp a version *label* (COMPOSERY_BUILD_VERSION), and why
		// the box could otherwise only compare labels while the website compares
		// digests - leaving the editor able to say "current" about a rebuild the
		// box page correctly offered an update for.
		//
		// There is no chicken and egg here though, because the box does not have to
		// work it out. The website resolved this digest and wrote it into the very
		// compose file that starts the container, so it is exactly what Docker
		// pulled. Passing the same string through the env file costs nothing and
		// lets both surfaces answer from the same fact.
		runtimeImage
			? `COMPOSERY_RUNTIME_IMAGE=${quoteEnvFileValue(runtimeImage)}`
			: undefined
	].filter(Boolean) as string[];

	// Sorted so an unchanged configuration renders an identical file every time.
	// Compose decides whether to recreate a container partly from this file, and
	// a stable order keeps a repair or a password change from looking like a
	// configuration change.
	const owner = Object.keys(config ?? {})
		.sort()
		.map((key) => {
			if (MANAGED_ENV_KEYS.has(key)) {
				throw new Error(
					`${key} is managed by Composery and cannot be set as box configuration.`
				);
			}
			return `${key}=${quoteEnvFileValue((config ?? {})[key])}`;
		});

	return [...managed, ...owner].join("\n").concat("\n");
}

// Belt and braces against the allowlist being widened carelessly later. The
// allowlist is the real gate; this makes the consequence of getting it wrong a
// loud failure at render time rather than a box that silently loses its password
// or its link to the control plane.
const MANAGED_ENV_KEYS = new Set([
	"COMPOSERY_HASHED_PASSWORD",
	"COMPOSERY_PASSWORD",
	"COMPOSERY_CLOUD_BOX_ID",
	"COMPOSERY_CLOUD_ORIGIN",
	"COMPOSERY_RUNTIME_IMAGE"
]);

function quoteEnvFileValue(value: string) {
	if (/[\r\n']/.test(value)) {
		throw new Error("Env file values must be single-line shell values.");
	}
	return `'${value}'`;
}

export function renderCompose(runtimeImage: string, runtimePort: number) {
	return `services:
  caddy:
    image: ${CADDY_IMAGE}
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      composery:
        condition: service_started

  composery:
    image: ${runtimeImage}
    container_name: composery
    restart: unless-stopped
    env_file: ./composery.env
    environment:
      - COMPOSERY_INIT=systemd
      - PORT=${runtimePort}
    privileged: true
    cgroup: host
    stop_signal: SIGRTMIN+3
    tmpfs:
      - /run
      - /run/lock
      - /tmp
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
      - composery_data:/data
    expose:
      - "${runtimePort}"

volumes:
  composery_data:
    name: composery_data
  caddy_data:
    name: caddy_data
  caddy_config:
    name: caddy_config
`;
}

export function renderRuntimeArtifacts({
	cloudBoxId,
	cloudOrigin,
	config,
	domain,
	runtimeAuthHash,
	runtimeImage,
	runtimePort
}: {
	cloudBoxId?: string;
	cloudOrigin?: string;
	config?: Readonly<Record<string, string>>;
	domain: string;
	runtimeAuthHash?: string;
	runtimeImage: string;
	runtimePort: number;
}): RuntimeArtifacts {
	return {
		caddyfile: renderCaddyfile(domain, runtimePort),
		compose: renderCompose(runtimeImage, runtimePort),
		env: renderComposeryEnv({
			cloudBoxId,
			cloudOrigin,
			config,
			runtimeAuthHash,
			runtimeImage
		})
	};
}
