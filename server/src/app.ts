import express from 'express'
import { Router } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { env } from '@/config'
import { routeDict } from '@/modules/route'
import { resWrapper } from '@/utils/response'
import { requestLogger } from '@/middleware/logger'
import { notFound } from '@/middleware/not-found'

const app = express()

app.use(helmet())
app.use(cors())
app.use(compression())
app.use(express.json())
app.use(requestLogger)

// 路由：依据 dict/route.ts 中的路由字典表，按模块各自创建 Router 挂载
for (const { module, routes } of routeDict) {
  const router = Router()
  for (const r of routes) {
    router[r.method](r.path, (req, res) => resWrapper(r.handler, req, res))
  }
  app.use(module, router)
}

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 404 兜底
app.use(notFound)

const { HOST, PORT } = env
app.listen(PORT, HOST, () => {
  console.log(`ExamHub server running on http://${HOST}:${PORT}`)
})
