import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { Builder, type WebDriver } from 'selenium-webdriver'
import * as chrome from 'selenium-webdriver/chrome'
import type {
  ContentBlock,
  ImageMeta,
  QuestionData,
  SectionData,
  SmartPaperJSON,
} from '@/modules/chalk/types'

/** 生成结果 */
export interface CreatePdfResult {
  /** 生成的 PDF 文件绝对路径 */
  pdfPath: string
  /** 试卷标题 */
  name: string
  /** 题目总数 */
  count: number
}

/**
 * 读取试卷目录下的 index.ts（含图片元信息），渲染为 HTML 后通过无头 Chrome 打印为 PDF。
 *
 * @param inputDir  试卷目录，需包含 index.ts 与 image/ 文件夹
 * @param outputDir PDF 输出目录（不存在会自动创建）
 * @returns 生成结果（含 PDF 路径、标题、题数）
 */
export async function createPdf(inputDir: string, outputDir: string): Promise<CreatePdfResult> {
  const indexTsPath = path.join(inputDir, 'index.ts')
  if (!fs.existsSync(indexTsPath)) {
    throw new Error(`试卷数据文件不存在：${indexTsPath}`)
  }

  // 1. 解析 index.ts（其内容为 `export default {...}` 形式的 JSON）
  const raw = fs.readFileSync(indexTsPath, 'utf8')
  const jsonStr = raw
    .replace(/^\s*export\s+default\s+/, '')
    .replace(/;\s*$/, '')
    .trim()
  const paper = JSON.parse(jsonStr) as SmartPaperJSON

  // 2. 构建 id -> 图片元信息 的映射，便于按 id 取文件名
  const imageMap = new Map<string, ImageMeta>()
  for (const img of paper.images ?? []) imageMap.set(img.id, img)

  // 3. 渲染 HTML
  const html = renderPaperHtml(paper, imageMap)

  // 4. 写入临时 HTML（放在试卷目录下，便于以相对路径引用 image/xxx.png）
  const htmlPath = path.join(inputDir, '_print.html')
  fs.writeFileSync(htmlPath, html, 'utf8')

  // 5. 无头 Chrome 打印为 PDF（base64）
  let base64 = ''
  try {
    base64 = await printHtmlToPdf(pathToFileURL(htmlPath).href)
  } finally {
    // 清理临时 HTML
    fs.rmSync(htmlPath, { force: true })
  }

  // 6. 写出 PDF 文件
  fs.mkdirSync(outputDir, { recursive: true })
  const safeName = sanitizeFilename(paper.paper.name)
  const dirName = path.basename(inputDir)
  const pdfFileName = safeName ? `${dirName}_${safeName}.pdf` : `${dirName}.pdf`
  const pdfPath = path.join(outputDir, pdfFileName)
  fs.writeFileSync(pdfPath, Buffer.from(base64, 'base64'))

  const count = paper.sections.reduce((a, s) => a + (s.items?.length ?? 0), 0)
  return { pdfPath, name: paper.paper.name, count }
}

// ─── HTML 渲染 ───

/** 转义 HTML 特殊字符 */
function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 将富文本内容块数组渲染为 HTML 片段 */
function renderBlocks(blocks: ContentBlock[] | undefined, imageMap: Map<string, ImageMeta>): string {
  if (!blocks || blocks.length === 0) return ''
  return blocks
    .map((b) => {
      if (b.type === 'text') {
        return escapeHtml(b.value).replace(/\r?\n/g, '<br>')
      }
      // 图片：大图（图表）独占一行，小图（公式/字符符号）行内显示
      const meta = imageMap.get(b.id)
      const filename = meta?.filename ?? `${b.id}.png`
      const w = meta?.width ?? b.width ?? 0
      const h = meta?.height ?? b.height ?? 0
      const isBlock = h > 100 || w > 350
      return `<img class="${isBlock ? 'block' : 'inline'}" src="image/${filename}" alt="">`
    })
    .join('')
}

/** 渲染单道题目（含答案与解析） */
function renderQuestion(q: QuestionData, imageMap: Map<string, ImageMeta>): string {
  const head = `<div class="q-head">${q.rank}.<span class="q-type">[${escapeHtml(q.type || '')}]</span></div>`
  const body = `<div class="q-body">${renderBlocks(q.question, imageMap)}</div>`
  const opts = (q.options ?? [])
    .map(
      (o) =>
        `<div class="opt"><span class="opt-label">${escapeHtml(o.label)}.</span> ${renderBlocks(o.content, imageMap)}</div>`,
    )
    .join('')
  const optsHtml = opts ? `<div class="opts">${opts}</div>` : ''

  const ansParts: string[] = []
  ansParts.push(`<div class="item"><span class="lab">【答案】</span>${escapeHtml(q.answer ?? '')}</div>`)
  if (q.easyWrongAnswer) {
    ansParts.push(`<div class="item"><span class="lab">【易错项】</span>${escapeHtml(q.easyWrongAnswer)}</div>`)
  }
  if (q.analysis?.length) {
    ansParts.push(`<div class="item"><span class="lab">【解析】</span>${renderBlocks(q.analysis, imageMap)}</div>`)
  }
  if (q.keypoints?.length) {
    const kp = q.keypoints.map((k) => escapeHtml(k.title)).join('、')
    ansParts.push(`<div class="item kp"><span class="lab">【考点】</span>${kp}</div>`)
  }
  if (q.source) {
    ansParts.push(`<div class="item src"><span class="lab">【来源】</span>${escapeHtml(q.source)}</div>`)
  }
  const ansHtml = `<div class="ans">${ansParts.join('')}</div>`

  return `<div class="q">${head}${body}${optsHtml}${ansHtml}</div>`
}

/** 渲染一个板块（含材料题材料） */
function renderSection(section: SectionData, index: number, imageMap: Map<string, ImageMeta>): string {
  // group 形如 "政治理论\n（20题）\n根据题目要求..."，取首段为板块名
  const groupName = (section.group || '').split(/\r?\n/)[0].trim() || '未命名板块'
  const count = section.count ?? section.items?.length ?? 0
  const tip = (section.tip || '').trim()
  const materialsHtml =
    section.materials?.length
      ? `<div class="materials">${renderBlocks(section.materials, imageMap)}</div>`
      : ''
  const itemsHtml = (section.items ?? []).map((q) => renderQuestion(q, imageMap)).join('')

  return `<section class="section${index === 0 ? ' first' : ''}">
    <div class="section-title">${escapeHtml(groupName)}（${count} 题）</div>
    ${tip ? `<div class="section-tip">${escapeHtml(tip)}</div>` : ''}
    ${materialsHtml}
    ${itemsHtml}
  </section>`
}

/** 渲染整张试卷 HTML */
function renderPaperHtml(paper: SmartPaperJSON, imageMap: Map<string, ImageMeta>): string {
  const total = paper.sections.reduce((a, s) => a + (s.items?.length ?? 0), 0)
  const sectionsHtml = paper.sections.map((s, i) => renderSection(s, i, imageMap)).join('')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.paper.name)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "SimSun", "宋体", "Microsoft YaHei", serif; font-size: 12pt; line-height: 1.75; color: #111; }
  .title { font-family: "SimHei", "黑体", "Microsoft YaHei", sans-serif; font-size: 19pt; font-weight: bold; text-align: center; margin: 0 0 3mm; }
  .sub { text-align: center; font-size: 10.5pt; color: #555; margin-bottom: 6mm; }
  .section { page-break-before: always; }
  .section.first { page-break-before: avoid; }
  .section-title { font-family: "SimHei", "黑体", sans-serif; font-size: 13.5pt; font-weight: bold; border-bottom: 1.5px solid #333; padding-bottom: 1.5mm; margin: 0 0 3mm; }
  .section-tip { font-size: 10.5pt; color: #555; margin: 0 0 4mm; }
  .materials { background: #f6f6f6; border-left: 3px solid #bbb; padding: 2.5mm 4mm; margin: 0 0 5mm; }
  /* 题目跨页连续排版，不强制每题独占；仅图片整体不可拆，放不下才移至下页留白 */
  .q { margin: 0 0 5mm; }
  .q-head { font-weight: bold; break-after: avoid; page-break-after: avoid; }
  .q-type { font-weight: normal; font-size: 10.5pt; color: #666; margin-left: 2mm; }
  .q-body { margin: 1mm 0 2mm; }
  .opts { margin: 0; }
  .opt { margin: 1mm 0; }
  .opt-label { font-weight: bold; break-after: avoid; page-break-after: avoid; }
  .ans { margin-top: 2mm; font-size: 11.5pt; }
  .ans .lab { font-weight: bold; color: #c0392b; }
  .ans .item { margin: 0.5mm 0; }
  .kp { color: #2a4d8f; }
  .src { color: #888; font-size: 10pt; }
  img { border: 0; max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }
  img.inline { vertical-align: middle; }
  img.block { display: block; margin: 2mm auto; }
</style>
</head>
<body>
  <h1 class="title">${escapeHtml(paper.paper.name)}</h1>
  <div class="sub">共 ${total} 题　|　采集时间：${escapeHtml(paper.paper.crawledEndAt ?? paper.paper.crawledAt ?? '')}</div>
  ${sectionsHtml}
</body>
</html>`
}

// ─── 无头 Chrome 打印 PDF ───

/** 用无头 Chrome 打开指定 file:// 地址并打印为 base64 PDF */
async function printHtmlToPdf(fileUrl: string): Promise<string> {
  const opts = new chrome.Options().addArguments(
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--window-size=1024,1400',
    // 独立 user-data-dir，避免与采集模块共用同一 Chrome 配置导致进程冲突
    `--user-data-dir=${path.join(os.tmpdir(), 'selenium-pdf-profile')}`,
  )
  const driver = new Builder().forBrowser('chrome').setChromeOptions(opts as any).build()

  // pageLoad 默认 5 分钟过长：本地页面 load 事件迟迟不来时 60s 即快速失败
  await driver.manage().setTimeouts({ pageLoad: 60_000 })

  try {
    // driver.get / printPage 均无内置超时上限，大页面（百图级别）可能长时间卡死；
    // 用总超时兜底，超时后 finally 中 driver.quit() 会终止会话并让挂起的命令失败
    return await withTimeout(
      runPrintFlow(driver, fileUrl),
      120_000,
      '生成 PDF 超时（>120s），可能页面过大或 Chrome 卡死',
    )
  } finally {
    // quit 同样加超时，防止会话清理本身卡住导致请求永不返回
    try {
      await withTimeout(driver.quit(), 15_000, 'driver.quit 超时')
    } catch (e) {
      console.error('[createPdf] driver.quit 失败/超时:', e instanceof Error ? e.message : e)
    }
  }
}

/** 加载页面 -> 等待图片 -> 打印为 base64（各步均可能阻塞，由外层 withTimeout 兜底） */
async function runPrintFlow(driver: WebDriver, fileUrl: string): Promise<string> {
  await driver.get(fileUrl)
  // 等待所有图片加载完成（成功或失败都算 complete），避免 PDF 中图片缺失
  await driver.wait(
    async () => {
      const done = await driver.executeScript<boolean>(() => {
        if (document.readyState !== 'complete') return false
        return Array.from(document.images).every((i) => i.complete)
      })
      return done
    },
    30000,
    '等待页面图片加载超时',
  )
  // 额外等待一帧，确保布局与图片绘制完成
  await driver.sleep(300)

  // 注：@types/selenium-webdriver 将 printPage 返回类型误声明为 void，实际返回 Promise<base64 | {data}>
  const result = (await (driver.printPage({
    orientation: 'portrait',
    scale: 1,
    background: true,
    width: 8.27, // A4 宽（英寸）
    height: 11.69, // A4 高（英寸）
    top: 0.6,
    bottom: 0.6,
    left: 0.7,
    right: 0.7,
    shrinkToFit: false,
    pageRanges: [],
  }) as unknown as Promise<any>)) as any
  const base64 = typeof result === 'string' ? result : (result?.data ?? result?.value ?? '')
  if (!base64) throw new Error('Chrome 打印 PDF 失败：返回内容为空')
  return base64
}

// ─── 工具方法 ───

/** 去除 Windows 文件名非法字符，并限制长度 */
function sanitizeFilename(name: string): string {
  return (name || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** 给 Promise 套一个总超时：超时则拒绝。原 Promise 无法取消（selenium 命令不可取消），由调用方后续 driver.quit() 终止会话 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(msg)), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
