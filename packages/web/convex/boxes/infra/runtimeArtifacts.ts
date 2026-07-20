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

export function renderComposeryEnv({
	cloudBoxId,
	cloudOrigin,
	runtimeAuthHash
}: {
	cloudBoxId?: string;
	cloudOrigin?: string;
	runtimeAuthHash?: string;
}) {
	if (Boolean(cloudBoxId) !== Boolean(cloudOrigin)) {
		throw new Error("Cloud box id and origin must be configured together.");
	}
	return [
		runtimeAuthHash
			? `COMPOSERY_HASHED_PASSWORD=${quoteEnvFileValue(runtimeAuthHash)}`
			: undefined,
		cloudBoxId
			? `COMPOSERY_CLOUD_BOX_ID=${quoteEnvFileValue(cloudBoxId)}`
			: undefined,
		cloudOrigin
			? `COMPOSERY_CLOUD_ORIGIN=${quoteEnvFileValue(cloudOrigin)}`
			: undefined
	]
		.filter(Boolean)
		.join("\n")
		.concat("\n");
}

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
	domain,
	runtimeAuthHash,
	runtimeImage,
	runtimePort
}: {
	cloudBoxId?: string;
	cloudOrigin?: string;
	domain: string;
	runtimeAuthHash?: string;
	runtimeImage: string;
	runtimePort: number;
}): RuntimeArtifacts {
	return {
		caddyfile: renderCaddyfile(domain, runtimePort),
		compose: renderCompose(runtimeImage, runtimePort),
		env: renderComposeryEnv({ cloudBoxId, cloudOrigin, runtimeAuthHash })
	};
}
