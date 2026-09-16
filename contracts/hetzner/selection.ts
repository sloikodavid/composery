import type { Selection } from "../selection";

/** Every request Composery sends to Hetzner, by the path and method it sends it with. */
export const hetznerSelection: Selection = {
	system: "Hetzner",
	documents: [
		{
			source: "https://docs.hetzner.cloud/cloud.spec.json",
			holder: "paths",
			operations: {
				"/servers": ["get", "post"],
				"/servers/{id}": ["get", "delete"],
				"/servers/{id}/actions/poweron": ["post"],
				"/servers/{id}/actions/shutdown": ["post"],
				"/servers/{id}/actions/poweroff": ["post"],
				"/primary_ips": ["get", "post"],
				"/primary_ips/{id}": ["get", "delete"],
				"/actions/{id}": ["get"],
				"/firewalls/{id}": ["get"],
				"/server_types": ["get"],
				"/images": ["get"],
			},
		},
	],
};
