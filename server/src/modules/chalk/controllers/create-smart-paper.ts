import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { ZipArchive } from 'archiver'
import { createSmartPaper } from '../services/chalk-crawler'
import { successRes, failRes, type ApiResponse } from '@/utils/response'
import { CODE } from '@/utils/code'
import { chalkConfig } from '@/modules/chalk/config'
import { createPdf } from '@/utils/create_pdf'
import { createMutex } from '@/utils/mutex'

/** 智能组卷列表项 */
interface SmartPaperListItem {
  /** 文件夹名称 */
  name: string
  /** 是否存在 index.ts 文件 */
  hasIndex: boolean
  /** 是否存在 pdf 文件 */
  hasPdf: boolean
  /** 采集时间（取自 index.ts 中 paper.crawledAt，无 index.ts 时为空字符串） */
  crawledAt: string
}

/** POST /chalk/create/smartpaper */
export async function useCreateSmartPaper(req: Request, _res: Response): Promise<ApiResponse> {
  const { num = 1 } = req.query
  const count = Number(num)
  if (!Number.isInteger(count) || count < 1) return failRes({ code: CODE.PARAM_INVALID, message: '参数 num 必须为正整数' })
  await createSmartPaper({ num: count })
  return successRes({ message: '采集任务已完成', data: null })
}

/** GET /chalk/smart-paper/list - 列出 smart-paper 目录下所有试卷文件夹信息 */
export async function useSmartPaperList(_req: Request, _res: Response): Promise<ApiResponse> {
  const baseDir = path.resolve(chalkConfig.outputDir, 'smart-paper')

  const list: SmartPaperListItem[] = []

  if (fs.existsSync(baseDir)) {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const paperDir = path.join(baseDir, entry.name)

      // 是否存在 index.ts
      const indexTsPath = path.join(paperDir, 'index.ts')
      const hasIndex = fs.existsSync(indexTsPath)

      // 是否存在 pdf 文件（目录下任意 .pdf）
      let hasPdf = false
      try {
        hasPdf = fs.readdirSync(paperDir).some(f => f.toLowerCase().endsWith('.pdf'))
      } catch { /* 目录读取失败视为无 pdf */ }

      // 从 index.ts 中提取 paper.crawledAt
      let crawledAt = ''
      if (hasIndex) {
        try {
          const content = fs.readFileSync(indexTsPath, 'utf-8')
          const match = content.match(/"crawledAt"\s*:\s*"([^"]*)"/)
          if (match) crawledAt = match[1]
        } catch { /* 读取失败则 crawledAt 留空 */ }
      }

      list.push({ name: entry.name, hasIndex, hasPdf, crawledAt })
    }
  }

  // 按文件夹名降序：雪花 ID 递增，最新生成的试卷排在最前
  list.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))

  return successRes({ message: '获取列表成功', data: list })
}

/** GET /chalk/smart-paper/download - 按 id（试卷文件夹名）将整个试卷文件夹压缩为 zip 返回 */
export async function useSmartPaperDownload(req: Request, res: Response): Promise<ApiResponse> {
  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return failRes({ code: CODE.PARAM_INVALID, message: '缺少参数 id' })
  }

  const baseDir = path.resolve(chalkConfig.outputDir, 'smart-paper')
  const paperDir = path.resolve(baseDir, id)

  // 防止路径穿越：解析后的路径必须仍在 baseDir 内
  const rel = path.relative(baseDir, paperDir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return failRes({ code: CODE.PARAM_INVALID, message: '非法的文件夹参数' })
  }

  // 文件夹不存在则返回空
  if (!fs.existsSync(paperDir) || !fs.statSync(paperDir).isDirectory()) {
    return successRes({ message: '文件夹不存在', data: null })
  }

  // 将整个试卷文件夹压缩为 zip 并流式返回
  const folderName = path.basename(paperDir)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`)

  const archive = new ZipArchive({ zlib: { level: 9 } })
  // destpath 传 folderName：zip 内保留外层文件夹（解压后为 folderName/index.ts、folderName/image/...）
  archive.directory(paperDir, folderName)
  archive.pipe(res)

  // 客户端断开时中止打包，避免继续向已关闭的响应流写入
  res.on('close', () => archive.abort())

  try {
    await archive.finalize()
  } catch (err) {
    // 响应头已发送：客户端中断或写入异常，记录后不再返回 JSON
    console.error('[SmartPaper Download] 打包/写入失败:', err instanceof Error ? err.message : err)
  }

  // 响应已流式写出，resWrapper 会因 res.headersSent 跳过 res.json
  return successRes({ message: '下载成功', data: null })
}

// PDF 生成互斥锁：createPdf 依赖无头 Chrome 且共用固定 user-data-dir，
// 并发触发会争抢 Chrome 配置导致失败/卡死；用 tryRun 保证同一时刻仅一个任务在跑，
// 其余请求立即返回“忙碌”，不排队、不堆积
const pdfMutex = createMutex()

/** GET /chalk/smart-paper/create-pdf - 按试卷文件夹名读取 index.ts 生成 PDF 试卷 */
export async function useSmartPaperCreatePdf(req: Request, _res: Response): Promise<ApiResponse> {
  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return failRes({ code: CODE.PARAM_INVALID, message: '缺少参数 id（试卷文件夹名）' })
  }

  const baseDir = path.resolve(chalkConfig.outputDir, 'smart-paper')
  const paperDir = path.resolve(baseDir, id)

  // 防止路径穿越：解析后的路径必须仍在 baseDir 内
  const rel = path.relative(baseDir, paperDir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return failRes({ code: CODE.PARAM_INVALID, message: '非法的文件夹参数' })
  }

  // 文件夹不存在
  if (!fs.existsSync(paperDir) || !fs.statSync(paperDir).isDirectory()) {
    return failRes({ code: CODE.PARAM_INVALID, message: `试卷文件夹不存在：${id}` })
  }

  // index.ts 不存在：缺少试卷数据，无法生成 PDF
  const indexTsPath = path.join(paperDir, 'index.ts')
  if (!fs.existsSync(indexTsPath)) {
    return failRes({ code: CODE.PARAM_INVALID, message: `试卷数据文件 index.ts 不存在：${id}` })
  }

  // 生成 PDF：直接输出到试卷文件夹内，与 index.ts / image/ 同级，便于随文件夹打包下载
  // 互斥执行：并发触发会争抢 Chrome user-data-dir；已有任务在跑时立即返回“忙碌”，不排队
  const task = pdfMutex.tryRun(() => createPdf(paperDir, paperDir))
  if (!task) {
    return failRes({ code: CODE.RATE_LIMIT, message: '已有生成任务进行中，请稍后重试' })
  }
  try {
    const result = await task
    return successRes({
      message: `PDF 创建成功：${result.name}（共 ${result.count} 题）`,
      data: { id, name: result.name, count: result.count, pdfPath: result.pdfPath },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '生成 PDF 失败'
    return failRes({ code: CODE.INTERNAL_ERROR, message: `PDF 创建失败：${message}` })
  }
}
