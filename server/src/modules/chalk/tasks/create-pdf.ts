import path from 'node:path'
import { createPdf } from '@/utils/create_pdf'

/**
 * CLI：根据试卷目录生成 PDF。
 * 用法：vite-node src/modules/chalk/tasks/create-pdf.ts <试卷目录> <输出目录>
 * 例：vite-node src/modules/chalk/tasks/create-pdf.ts ./examination/smart-paper/336755890931630080 ./examination/smart-paper-pdf
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const inputDir = args[0]
  const outputDir = args[1]
  if (!inputDir || !outputDir) {
    console.error('用法: vite-node src/modules/chalk/tasks/create-pdf.ts <试卷目录> <输出目录>')
    process.exit(1)
  }

  console.log('# 开始生成 PDF #')
  const startTime = Date.now()
  const result = await createPdf(path.resolve(inputDir), path.resolve(outputDir))
  const totalSec = Math.floor((Date.now() - startTime) / 1000)
  console.log(`# PDF 已生成：${result.pdfPath}（${result.name}，共 ${result.count} 题，耗时 ${totalSec} 秒）#`)

  const msg = JSON.stringify({ code: '000000' })
  if (process.send) process.send(msg)
}

main().catch((e) => {
  console.error('[Chalk Task] 生成 PDF 失败:', e)
  process.exit(1)
})
