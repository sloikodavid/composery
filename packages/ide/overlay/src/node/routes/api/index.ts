import * as express from "express"
import { httpAuth } from "./auth"
import { apiConfig } from "./config"
import { apiBasePath } from "./constants"
import { router as terminalRouter, wsRouter as terminalWsRouter } from "./terminals"

export const enabled = apiConfig.enabled
export const router = express.Router()
export const wsRouter = terminalWsRouter

if (apiConfig.enabled) {
  const v1 = express.Router()
  v1.use(httpAuth())
  v1.use(terminalRouter)
  router.use(apiBasePath, v1)
} else {
  router.use(apiBasePath, (_req, res) => {
    res.status(404).json({ message: "API disabled" })
  })
}
