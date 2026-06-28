import * as express from "express"
import { httpAuth } from "./auth"
import { apiConfig } from "./config"
import { router as execRouter } from "./exec"
import { httpRouter as sessionHttpRouter, wsRouter as sessionWsRouter } from "./session"

export const enabled = apiConfig.enabled
export const router = express.Router()
export const wsRouter = sessionWsRouter

if (apiConfig.enabled) {
  const v1 = express.Router()
  v1.use(httpAuth())
  v1.use(execRouter)
  v1.use(sessionHttpRouter)
  router.use("/v1", v1)
} else {
  router.use("/v1", (_req, res) => {
    res.status(404).json({ message: "API disabled" })
  })
}
