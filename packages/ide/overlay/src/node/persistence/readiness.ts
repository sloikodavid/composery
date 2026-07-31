import { constants, promises as fs } from "fs"

const persistenceRunDir = "/run/persistence"
const readyPath = `${persistenceRunDir}/ready`

type PersistenceReadiness = {
  ready: boolean
  message: string
  updatedAt?: string
}

const cacheTtlMs = 1000
let cached: { value: PersistenceReadiness; at: number } | undefined

export async function checkPersistenceReadiness(): Promise<PersistenceReadiness> {
  // Cache age is elapsed time, not civil time. Date.now() can move backwards
  // after an NTP correction or host clock change and otherwise keep a stale
  // readiness result alive indefinitely.
  if (cached && performance.now() - cached.at < cacheTtlMs) {
    return cached.value
  }
  const value = await readPersistenceReadiness()
  cached = { value, at: performance.now() }
  return value
}

async function readPersistenceReadiness(): Promise<PersistenceReadiness> {
  let data: string
  try {
    const file = await fs.open(readyPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await file.stat()
      if (!metadata.isFile()) {
        return {
          ready: false,
          message: "persistence ready file cannot be read",
        }
      }
      data = await file.readFile("utf8")
    } finally {
      await file.close()
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { ready: false, message: "persistence is starting" }
    }

    return { ready: false, message: "persistence ready file cannot be read" }
  }

  let parsed: { ready?: unknown; updatedAt?: unknown }
  try {
    parsed = JSON.parse(data)
  } catch {
    return { ready: false, message: "persistence ready file is invalid" }
  }

  if (parsed.ready !== true) {
    return { ready: false, message: "persistence is starting" }
  }

  if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.length === 0) {
    return { ready: false, message: "persistence ready file is invalid" }
  }

  return {
    ready: true,
    message: "persistence is ready",
    updatedAt: parsed.updatedAt,
  }
}

export function renderStartupPage(healthUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<title>Preparing workspace</title>
<style>
html,body{height:100%;overflow:hidden;width:100%}
body{margin:0;background:#cdc9c4;color:#323229;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif;display:grid;place-items:center}
main{box-sizing:border-box;padding:max(2rem,env(safe-area-inset-top,0px)) max(2rem,env(safe-area-inset-right,0px)) max(2rem,env(safe-area-inset-bottom,0px)) max(2rem,env(safe-area-inset-left,0px))}
h1{font-size:1.25rem;font-weight:600;line-height:1.3;margin:0}
@media (prefers-color-scheme:dark){body{background:#1d1b1b;color:#c1b5a9}}
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
`
}
