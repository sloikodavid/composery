import { describe, expect, test, vi } from "vitest";

import { TerminalDataFlowControl } from "../packages/ide/overlay/lib/vscode/src/vs/platform/terminal/common/terminalDataFlowControl.ts";

describe("terminal data flow control", () => {
	test("a legacy browser registers through its first acknowledgement", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.acceptData(4_096);

		flow.acknowledge("browser", 4_096);

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(4_096);
	});

	test("broadcast consumers cannot acknowledge the same bytes twice", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.register("api");
		flow.acceptData(8_192);

		flow.acknowledge("api", 8_192);
		expect(acknowledge).not.toHaveBeenCalled();

		flow.acknowledge("browser", 8_192);
		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenLastCalledWith(8_192);

		flow.acceptData(1_024);
		flow.acknowledge("api", 1_024);
		expect(acknowledge).toHaveBeenCalledOnce();
		flow.acknowledge("browser", 1_024);
		expect(acknowledge).toHaveBeenCalledTimes(2);
		expect(acknowledge).toHaveBeenLastCalledWith(1_024);
	});

	test("a remaining consumer takes over at its own acknowledged position", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.register("api");
		flow.acceptData(10);
		flow.acknowledge("api", 10);

		flow.unregister("browser");

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(10);
	});

	test("the last consumer to leave drains what nobody acknowledged", () => {
		// The pty pauses above its high watermark until the outstanding bytes are
		// acknowledged. With every consumer gone there is nobody left to do it, so
		// a terminal whose only reader disconnected would stall mid-command - the
		// documented promise is that it keeps running.
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("api");
		flow.acceptData(8_192);

		flow.unregister("api");

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(8_192);

		// And it has to keep draining, or the very next chunk stalls it again.
		flow.acceptData(512);
		expect(acknowledge).toHaveBeenLastCalledWith(512);

		// A consumer arriving later starts at the tail rather than re-acknowledging
		// everything that ran while nobody was attached.
		flow.register("api");
		flow.acceptData(256);
		flow.acknowledge("api", 256);
		expect(acknowledge).toHaveBeenLastCalledWith(256);
		expect(acknowledge).toHaveBeenCalledTimes(3);
	});

	test("replay establishes a new live-data baseline", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.acceptData(10);
		flow.resetAfterReplay();
		flow.acceptData(5);
		flow.acknowledge("browser", 5);

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(5);
	});
});
