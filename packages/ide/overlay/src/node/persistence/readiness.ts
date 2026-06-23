import { promises as fs } from "fs";

const persistenceRunDir = "/run/persistence";
const readyPath = `${persistenceRunDir}/ready`;

type PersistdReadiness = {
	ready: boolean;
	message: string;
	updatedAt?: string;
};

export async function checkPersistdReadiness(): Promise<PersistdReadiness> {
	let data: string;
	try {
		data = await fs.readFile(readyPath, "utf8");
	} catch (error: any) {
		if (error?.code === "ENOENT") {
			return { ready: false, message: "persistence is starting" };
		}

		return { ready: false, message: "persistence ready file cannot be read" };
	}

	let parsed: { ready?: unknown; updatedAt?: unknown };
	try {
		parsed = JSON.parse(data);
	} catch {
		return { ready: false, message: "persistence ready file is invalid" };
	}

	if (parsed.ready !== true) {
		return { ready: false, message: "persistence is starting" };
	}

	if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.length === 0) {
		return { ready: false, message: "persistence ready file is invalid" };
	}

	return {
		ready: true,
		message: "persistence is ready",
		updatedAt: parsed.updatedAt
	};
}

export function renderStartupPage(healthUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Preparing workspace</title>
<style>
html,body{height:100%;overflow:hidden;width:100%}
body{margin:0;background:#fefdf9;color:#2d241e;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center}
main{box-sizing:border-box;padding:2rem}
h1{font-size:1.25rem;font-weight:600;line-height:1.3;margin:0}
@media (prefers-color-scheme:dark){body{background:#2c231c;color:#f5f1ea}}
</style>
</head>
<body>
<main><h1>Preparing workspace</h1></main>
<script>
async function waitUntilReady() {
  try {
    const healthUrl = ${JSON.stringify(healthUrl)};
    if ((await fetch(healthUrl, { cache: "no-store" })).ok) {
      location.reload();
      return;
    }
  } catch {}
  setTimeout(waitUntilReady, 1000);
}
waitUntilReady();
</script>
</body>
</html>
`;
}
