import * as express from "express"
import { verifyKey } from "./keystore"
import { authFail, rateLimit } from "./ratelimit"

export interface ApiRequest extends express.Request {
  apiKeyId?: string
}

export interface AuthResult {
  id?: string
  status?: number
  message?: string
}

function clientIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown"
}

// Accept `Authorization: Bearer <key>` (primary) or `X-API-Key: <key>` (fallback).
function extractKey(req: express.Request): string | undefined {
  const authorization = req.headers["authorization"]
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim()
  }
  const apiKey = req.headers["x-api-key"]
  if (typeof apiKey === "string" && apiKey) return apiKey.trim()
  return undefined
}

/**
 * Shared auth + rate-limit check used by both the HTTP middleware and the
 * websocket handler (which cannot use Express error flow cleanly).
 */
export async function authenticate(req: express.Request): Promise<AuthResult> {
  const ip = clientIp(req)
  if (!authFail.allow(ip)) {
    return { status: 429, message: "Too many failed attempts" }
  }
  const secret = extractKey(req)
  const id = secret ? await verifyKey(secret) : undefined
  if (!id) {
    authFail.record(ip)
    return { status: 401, message: "Invalid or missing API key" }
  }
  if (!rateLimit.allow(id)) {
    return { status: 429, message: "Rate limit exceeded" }
  }
  return { id }
}

/** Express middleware form for the HTTP routes. */
export function httpAuth(): express.RequestHandler {
  return async (req, res, next) => {
    const result = await authenticate(req)
    if (!result.id) {
      res.status(result.status ?? 401).json({ message: result.message })
      return
    }
    ;(req as ApiRequest).apiKeyId = result.id
    next()
  }
}
