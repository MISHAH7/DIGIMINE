import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { authRouter, authenticate } from './auth.js'
import { errorHandler } from './lib.js'
import { masterRouter } from './masterdata.js'
import { opsRouter } from './operations.js'
import { labourRouter } from './labour.js'
import { financeRouter } from './finance.js'
import { fieldRouter } from './field.js'
import { reportsRouter } from './reports.js'
import { approvalsRouter } from './approvals.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')
  app.use(cors({ origin: origins }))
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
  app.use('/api/auth', authRouter)

  const api = express.Router()
  api.use(authenticate)
  api.use(masterRouter)
  api.use(opsRouter)
  api.use(labourRouter)
  api.use(financeRouter)
  api.use(fieldRouter)
  api.use(reportsRouter)
  api.use('/approvals', approvalsRouter)
  app.use('/api', api)

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }))
  app.use(errorHandler)
  return app
}
