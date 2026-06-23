import { createRequire } from "module"
import * as path from "path"
import { rootPath } from "../../constants"

// node-pty acquisition, isolated so the strategy can change without touching any
// other file. node-pty is already compiled into the shipped VS Code server
// bundle (same Node ABI as code-server's process), so we resolve it from there
// if a bare require misses. If this proves unreliable on the real Linux build,
// the fallback is to add `node-pty` to the code-server build deps - and only
// this file changes. See PLAN.md section 8.3.

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
    } catch {
      /* try next */
    }
  }

  throw new Error("node-pty not found; add it to the code-server build (see pty.ts)")
}
