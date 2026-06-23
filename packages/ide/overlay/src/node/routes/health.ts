import { Router } from "express"
import { checkPersistdReadiness } from "../persistence/readiness"
import { wss, Router as WsRouter } from "../wsRouter"

export const router = Router()

router.get("/", async (req, res) => {
  const persistence = await checkPersistdReadiness()
  res.status(persistence.ready ? 200 : 503).json({
    status: req.heart.alive() ? "alive" : "expired",
    lastHeartbeat: req.heart.lastHeartbeat,
    persistence,
  })
})

export const wsRouter = WsRouter()

wsRouter.ws("/", async (req) => {
  wss.handleUpgrade(req, req.ws, req.head, (ws) => {
    ws.addEventListener("message", () => {
      ws.send(
        JSON.stringify({
          event: "health",
          status: req.heart.alive() ? "alive" : "expired",
          lastHeartbeat: req.heart.lastHeartbeat,
        }),
      )
    })
    req.ws.resume()
  })
})
