import { createRequire } from "module"
import * as path from "path"
import { rootPath } from "../../constants"

// node-pty is resolved from the shipped VS Code server bundle (same Node ABI as this process).
let cached: any | undefined

export function nodePty(): any {
  if (cached) return cached

  const resolver = createRequire(__filename)
  const candidates = [
    "node-pty",
    path.join(rootPath, "lib/vscode/node_modules/node-pty"),
    path.join(rootPath, "lib/vscode/remote/node_modules/node-pty"),
    path.join(rootPath, "node_modules/node-pty"),
  ]
  for (const candidate of candidates) {
    try {
      cached = resolver(candidate)
      return cached
    } catch {}
  }

  throw new Error("node-pty not found; add it to the code-server build (see pty.ts)")
}
