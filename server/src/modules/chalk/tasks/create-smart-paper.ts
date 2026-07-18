import fs from 'node:fs'
import path from 'node:path'
import SmartPaperCrawler from '../models/smartPaper.ts'
import { chalkConfig } from '@/modules/chalk/config/index.ts'
import { snowflake } from '@/utils/snowflake.ts'

async function main(): Promise<void> {
  const crawler = new SmartPaperCrawler()

  try {
    console.log('# 登录开始 #')
    await crawler.init()
    await crawler.login()
    console.log('# 登录完成 #')

    const args = process.argv.slice(2).filter(a => !a.startsWith('-'))
    const num = parseInt(args[0] ?? '1', 10)
    if (!Number.isInteger(num) || num < 1) return

    console.log('# 智能组卷开始 #')
    const startTime = Date.now()
    const baseDir = path.resolve(chalkConfig.outputDir, 'smart-paper')

    for (let i = 0; i < num; i++) {
      const rank = i + 1
      console.log(`# 第 ${rank} / ${num} 套 - 智能组卷开始 #`)
      try {
        // 雪花算法生成唯一 ID，作为本次试卷的目录名，避免多次生成互相覆盖
        const id = snowflake.nextId()
        const paperDir = path.resolve(baseDir, id)
        fs.mkdirSync(paperDir, { recursive: true })

        // 图片保存到 {paperDir}/image/，与 index.ts 同级
        const json = await crawler.examinationAnswer(paperDir)
        console.log('# 开始保存 #')
        const tsContent = `export default ${JSON.stringify(json, null, 2)}\n`
        const tsPath = path.join(paperDir, 'index.ts')
        fs.writeFileSync(tsPath, tsContent, 'utf-8')
        console.log(`# 已保存：${tsPath}`)
      } catch (e) {
        console.error('error', e)
        break
      }
      console.log(`# 第 ${rank} 套 - 智能组卷完成 #`)
    }

    const totalSec = Math.floor((Date.now() - startTime) / 1000)
    console.log(`# 共 ${num} 套，消耗 ${totalSec} 秒，平均 ${Math.floor(totalSec / num)} 秒/套 #`)

    const msg = JSON.stringify({ code: '000000' })
    if (process.send) {
      process.send(msg)
    }
  } finally {
    await crawler.quit()
    console.log('# 已关闭浏览器 #')
  }
}

main().catch((e) => {
  console.error('[Chalk Task] 致命错误:', e)
  process.exit(1)
})
