// Mobile captures at the iPhone 17 Pro content viewport (402x778 @3x; the frame
// draws the 62pt status bar + 34pt bottom safe area). Welcome, a proposal in the
// editor, and Claude Code with a prompt ready to send. Run per theme:
//   node screenshots/capture-mobile.mjs dark
//   node screenshots/capture-mobile.mjs light
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launch, login, RAW } from "./lib.mjs";

const scheme = process.argv[2] === "light" ? "light" : "dark";
const dir = path.join(RAW, scheme);
mkdirSync(dir, { recursive: true });

const { browser, page } = await launch({
	width: 402,
	height: 778,
	dsf: 3,
	mobile: true,
	scheme
});
await login(page);

const shot = (name) => page.screenshot({ path: path.join(dir, `${name}.png`) });

// 1) Welcome on a phone.
await page.waitForTimeout(1500);
await shot("mobile-welcome");

// 2) Editor: a proposal (a different document than the desktop hero). Mobile UA
//    is Mac-like, so Quick Open is Cmd+P; retry until the tab exists.
const tab = page
	.locator(".tabs-container .tab", { hasText: "northwind" })
	.first();
for (const combo of ["Meta+KeyP", "Meta+KeyP", "Control+KeyP"]) {
	if (await tab.count()) break;
	await page.keyboard.press(combo);
	await page.waitForTimeout(1200);
	await page.keyboard.type("proposals/northwind");
	await page.waitForTimeout(1500);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(2500);
}
await tab.waitFor({ timeout: 15000 });
await page.keyboard.press("Meta+Shift+KeyV"); // Markdown: Open Preview (Mac UA)
await page.waitForTimeout(4500);
await shot("mobile-editor");

// 3) Claude Code on the phone: the user about to hand off a task. Typing the
//    prompt (not sending) reads clean on a phone and needs no model quota.
await page.keyboard.press("Control+Backquote");
await page.waitForTimeout(3500);
await page.keyboard.type(
	"cd ~/workspace && rm -rf drafts && git clean -qfd && git checkout -- . && clear"
);
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);

await page.keyboard.type("claude");
await page.keyboard.press("Enter");
await page.waitForTimeout(18000);
await page.keyboard.press("Enter"); // trust this folder
await page.waitForTimeout(8000);

await page.keyboard.type(
	"Draft this week's client update from my commits and calendar"
);
await page.waitForTimeout(2500);
await shot("mobile-terminal");

console.log(`mobile ${scheme} shots done`);
await browser.close();
