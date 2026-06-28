import * as crypto from "crypto"
import { promises as fs } from "fs"
import { keysPath } from "./config"

// Cross-language contract: path, JSON shape, and "sha256:" + hex hashing must stay identical to Rust keystore.rs.

interface KeyRecord {
  id: string
  name: string
  prefix: string
  hash: string
  created_at: number
}

interface KeyStore {
  version: number
  keys: KeyRecord[]
}

function hashSecret(secret: string): string {
  return "sha256:" + crypto.createHash("sha256").update(secret).digest("hex")
}

let cache: { store: KeyStore; mtimeMs: number } | undefined

async function readStore(): Promise<KeyStore> {
  const file = keysPath()
  try {
    const stat = await fs.stat(file)
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.store
    const store = JSON.parse(await fs.readFile(file, "utf8")) as KeyStore
    cache = { store, mtimeMs: stat.mtimeMs }
    return store
  } catch (error: any) {
    if (error.code === "ENOENT") return { version: 1, keys: [] }
    throw error
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export async function verifyKey(secret: string): Promise<string | undefined> {
  if (!secret) return undefined
  const presented = hashSecret(secret)
  const store = await readStore()
  for (const key of store.keys) {
    if (timingSafeEqualStr(key.hash, presented)) {
      return key.id
    }
  }
  return undefined
}
