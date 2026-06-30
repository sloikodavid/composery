export const COMPOSERY_COMPOSE_PATH = "/opt/composery-web/compose.yml";
export const COMPOSERY_ENV_PATH = "/opt/composery-web/composery.env";
export const COMPOSERY_CADDYFILE_PATH = "/opt/composery-web/Caddyfile";

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

export function renderComposeryEnv(runtimeAuthHash: string) {
	return `HASHED_PASSWORD=${quoteEnvFileValue(runtimeAuthHash)}
`;
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
    image: caddy:2-alpine
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
	domain,
	runtimeAuthHash,
	runtimeImage,
	runtimePort
}: {
	domain: string;
	runtimeAuthHash: string;
	runtimeImage: string;
	runtimePort: number;
}): RuntimeArtifacts {
	return {
		caddyfile: renderCaddyfile(domain, runtimePort),
		compose: renderCompose(runtimeImage, runtimePort),
		env: renderComposeryEnv(runtimeAuthHash)
	};
}
