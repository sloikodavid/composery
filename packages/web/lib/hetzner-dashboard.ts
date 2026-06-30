const PROJECT = process.env.NEXT_PUBLIC_HETZNER_PROJECT_ID;

function consoleUrl(path: string) {
	if (!PROJECT) return null;
	return `https://console.hetzner.com/projects/${PROJECT}/${path}`;
}

export function hetznerServersUrl() {
	return consoleUrl("servers");
}

export function hetznerServerUrl(serverId: number | null | undefined) {
	if (!serverId) return null;
	return consoleUrl(`servers/${serverId}/overview`);
}
