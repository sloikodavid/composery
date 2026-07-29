import { describe, expect, test } from "vitest";

import { loadOverlayModule } from "../../../../../support/overlay.ts";

type QrExtension = {
	activate: (context: {
		subscriptions: { push(disposable: unknown): void };
	}) => void;
};

function loadQrExtension(
	networkInterfaces: () => Record<
		string,
		Array<{
			address: string;
			family: string;
			internal: boolean;
		} | null>
	> = () => ({}),
	vscode: unknown = { commands: {}, window: {} }
) {
	const loaded = loadOverlayModule<QrExtension>({
		source: new URL(
			"../../../../../../overlay/lib/vscode/extensions/composery-qr/extension.js",
			import.meta.url
		),
		dependencies: {
			"node:os": { networkInterfaces },
			vscode
		},
		globals: { URL }
	});

	return {
		activate: (context: {
			subscriptions: { push(disposable: unknown): void };
		}) => loaded.exports.activate(context),
		isReachableFromAnotherDevice: loaded.binding<(url: URL) => boolean>(
			"isReachableFromAnotherDevice"
		),
		networkAddresses:
			loaded.binding<(url: URL) => string[]>("networkAddresses"),
		render: loaded.binding<(url: string) => string>("render")
	};
}

describe("QR extension", () => {
	test("refuses addresses another device cannot reach", () => {
		const { isReachableFromAnotherDevice } = loadQrExtension();

		for (const reachable of [
			"https://box.test/",
			"http://192.168.1.192:8080/",
			"http://127.example.com/"
		]) {
			expect(isReachableFromAnotherDevice(new URL(reachable)), reachable).toBe(
				true
			);
		}

		for (const unreachable of [
			"http://localhost:8080/",
			"http://box.localhost/",
			"http://localhost./",
			"http://127.0.0.1:8080/",
			"http://127.1:8080/",
			"http://2130706433:8080/",
			"http://0.0.0.0:8080/",
			"http://[::1]/",
			"http://[::]/",
			"http://[::ffff:127.0.0.1]/",
			"ftp://box.test/"
		]) {
			expect(
				isReachableFromAnotherDevice(new URL(unreachable)),
				unreachable
			).toBe(false);
		}
	});

	test("offers useful LAN links before container bridge addresses", () => {
		const { networkAddresses } = loadQrExtension(() => ({
			docker: [{ address: "172.18.0.2", family: "IPv4", internal: false }],
			wifi: [
				{ address: "192.168.1.192", family: "IPv4", internal: false },
				{ address: "fe80::1", family: "IPv6", internal: false }
			],
			loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }]
		}));

		expect(
			networkAddresses(
				new URL("http://localhost:8080/code/?folder=/home/user#readme")
			)
		).toEqual([
			"http://192.168.1.192:8080/code/?folder=/home/user#readme",
			"http://172.18.0.2:8080/code/?folder=/home/user#readme"
		]);
	});

	test("opens a selected network address from an explanatory toast", async () => {
		const lanUrl = "http://192.168.1.192:8080/";
		let command: ((value: string) => Promise<void>) | undefined;
		let warning: unknown[] | undefined;
		let opened: unknown;
		const { activate } = loadQrExtension(
			() => ({
				wifi: [{ address: "192.168.1.192", family: "IPv4", internal: false }]
			}),
			{
				commands: {
					registerCommand(
						_id: string,
						handler: (value: string) => Promise<void>
					) {
						command = handler;
						return { dispose() {} };
					}
				},
				env: {
					openExternal(uri: unknown) {
						opened = uri;
						return Promise.resolve(true);
					}
				},
				Uri: { parse: (value: string) => value },
				window: {
					showWarningMessage(...items: unknown[]) {
						warning = items;
						return Promise.resolve(lanUrl);
					}
				}
			}
		);

		activate({ subscriptions: { push() {} } });
		if (!command) throw new Error("QR command was not registered");
		await command("http://localhost:8080/");

		expect(warning).toEqual([
			"This address only works on this device. Try one below. Composery found these addresses on this computer, but cannot tell which one your other device can use.",
			lanUrl
		]);
		expect(opened).toBe(lanUrl);
	});

	test("carries the specification's four-module quiet zone at every version", () => {
		const { render } = loadQrExtension();

		for (const url of [
			"http://192.168.1.192:8080/",
			"https://a-much-longer-name.boxes.composery.app/?folder=/home/user/src"
		]) {
			const svg = render(url);
			const size = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
			const quietZone = Number(/<path d="M(\d+),/.exec(svg)?.[1]);

			expect(quietZone / 8, url).toBe(4);
			expect(size, url).toBeGreaterThan(quietZone * 2);
		}
	});
});
