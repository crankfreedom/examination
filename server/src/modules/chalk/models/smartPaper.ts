import { By, type WebElement } from 'selenium-webdriver'
import { WebCrawler } from '@/utils/web-crawler'
import { chalkConfig } from '@/modules/chalk/config'
import { ChalkLogin } from '../services/chalk-login'
import type { ContentBlock, RichOption, QuestionData, KeypointItem, SectionData, ImageMeta, SmartPaperJSON } from '../types'

export class ChalkCrawler extends WebCrawler {
  private readonly loginService: ChalkLogin
  private paperUrl: string = 'https://www.fenbi.com/spa/tiku/guide/catalog/xingce?prefix=xingce'

  constructor() {
    super()
    this.loginService = new ChalkLogin(this)
  }

  /** 初始化 WebDriver（使用 chalk 配置的浏览器） */
  async init(): Promise<void> {
    await super.init(chalkConfig.browser)
  }

  // ─── 登录 ───

  /** 委托通用登录服务执行粉笔网登录 */
  async login(): Promise<void> {
    await this.loginService.login()
  }

  // ─── 题目提取 ───

  /** 从单个题目 DOM 提取 QuestionData */
  private async extractQuestion(art: WebElement, imageDir: string): Promise<QuestionData> {
    // 题目序号
    const rankEl = await art.findElement(By.css('.title .title-index'))
    const rankText = await rankEl.getText()
    const rank = parseInt(rankText, 10) || 0

    // 题目类型
    const typeEl = await art.findElement(By.css('.title .title-type-name'))
    const type = await typeEl.getText()

   // 题干（富文本，含图片）
   const questionEl = await art.findElement(By.css('app-question-choice app-format-html'))
   const question = await this.getRichContent(questionEl, imageDir)

    // 选项
    const optionEls = await art.findElements(By.css('app-choice-radio .choice-radios > li'))
    const options: RichOption[] = []
    for (const opt of optionEls) {
      const prexEl = await opt.findElement(By.css('.input-radio'))
      const label = await prexEl.getText()
      let textEl: WebElement
      try {
        textEl = await opt.findElement(By.css('.input-text'))
      } catch {
        textEl = await opt.findElement(By.css('app-format-html'))
      }
      const optContent = await this.getRichContent(textEl, imageDir)
      options.push({ label, content: optContent })
    }

   // 正确答案
   const correctEl = await art.findElement(By.css('app-solution-overall .correct-answer'))
   const answer = await correctEl.getText()

   // 易错项（尝试在正确答案附近或统计中查找）
   let easyWrongAnswer = ''
    try {
      const wrongEl = await art.findElement(By.css('app-solution-overall .error-prone'))
     easyWrongAnswer = await wrongEl.getText()
    } catch { /* 无独立易错项 */ }
    // 如果易错项没找到，尝试从统计中提取
   if (!easyWrongAnswer) {
      try {
        const statEls = await art.findElements(By.css('app-solution-overall .overall-item'))
        for (const s of statEls) {
          const titleTxt = await s.findElement(By.css('.overall-item-title')).getText()
          if (titleTxt.includes('易错项')) {
            easyWrongAnswer = (await s.findElement(By.css('.overall-item-value')).getText()).trim()
          }
        }
      } catch { /* 统计中无易错项 */ }
    }

   // 解析（富文本）
   let analysis: ContentBlock[] = []
   try {
    const analysisEl = await art.findElement(By.css('section[id^="section-solution-"] .content'))
     analysis = await this.getRichContent(analysisEl, imageDir)
   } catch { /* 无解析 */ }

   // 考点（支持多个）
  const kpNameEls = await art.findElements(By.css('section[id^="section-keypoint-"] .solution-keypoint-item-name'))
  const keypoints: KeypointItem[] = []
  for (const nameEl of kpNameEls) {
     const title = await nameEl.getText()
     keypoints.push({ title, detail: '', frequency: 5 })
   }

   // 来源
   let source = ''
   try {
    const originEl = await art.findElement(By.css('section[id^="section-source-"] .content'))
     source = await originEl.getText()
   } catch { /* 无来源 */ }

   return { rank, type, group: '', question, options, answer, easyWrongAnswer, analysis, keypoints, source }
  }

 /** 从文章元素中提取材料内容 */
  private async extractMaterial(art: WebElement, imageDir: string): Promise<ContentBlock[]> {
    try {
      const materialContentEl = await art.findElement(By.css('app-materials .material-content'))
      return await this.getRichContent(materialContentEl, imageDir)
    } catch { /* 无材料内容 */ }
    return []
  }

  // ─── 智能组卷 ───

  async examinationAnswer(imageDir: string): Promise<SmartPaperJSON> {
    const driver = this.getDriver()
    await this.sleep()

    await driver.get(this.paperUrl)
    await this.sleep()

    // 点击智能组卷
    await this.clickElement('//*[@id="calalog-page"]/main/div[1]/div[1]/fb-tiku-catalog/div/ul/li[3]/div')
    await this.sleep()
    // 点击生成试卷按钮
    await this.clickElement('/html/body/app-customize-smart-question/div/div/footer/button[2]')
    // 等待试卷元素出现
    await this.findElement('/html/body/app-root/app-exercise')

    const pageUrl = await driver.getCurrentUrl()
    const key = pageUrl.split('/').reverse()[1] ?? ''
    console.log('pageUrl', pageUrl)
    console.log('key', key)

    // 提交试卷
    await this.sleep()
    // 点击交卷按钮
    await this.clickElement('/html/body/app-root/app-exercise/app-nav-header/header/div/div[3]/div')
    await this.sleep()
    // 二次确认交卷
    await this.clickElement('/html/body/app-root/app-modal-common/div/div/div[2]/button[2]')
    await this.sleep(5000)

    // 等待答案结果页面出现
    await this.findElement('/html/body/app-root/app-solution/div/app-report-overall')
    const anwserUrl = await driver.getCurrentUrl()
    console.log('anwserUrl', anwserUrl)

    // 获取标题
    const headerEl = await this.findElement('/html/body/app-root/app-solution/app-nav-header/header/div/div[2]')
    const name = await headerEl.getText()

    // 清理干扰元素
    await this.deleteElement('app-report-overall', 'css')

    // ─── 逐题提取（含板块和材料题分组） ───
    const container = await this.findElement('app-tis > .tis-container', 'css')
    const children = await container.findElements(By.xpath('./*'))
    console.log('children count', children.length)

   const sections: SectionData[] = []
   let currentSection: SectionData | null = null
   const images: ImageMeta[] = []

   const collectImages = (blocks: ContentBlock[]) => {
      for (const b of blocks) {
        if (b.type === 'image') {
          images.push({ id: b.id, filename: `${b.id}.png`, width: b.width, height: b.height })
        }
      }
    }

   for (let i = 0; i < children.length; i++) {
      const child = children[i]

      // 判断是否为板块标题（不含 app-ti 即为标题元素）
      const hasArticle = await driver.executeScript<boolean>(
        'return !!arguments[0].querySelector("app-ti")', child
      )

     if (!hasArticle) {
      const titleText = await child.getText()
      // 解析板块标题：如 "政治理论（20题）" → group="政治理论", count=20
      const match = titleText.match(/^(.+?)（(\d+)题）/);
      const group = match ? match[1].trim() : titleText.trim()
       const count = match ? parseInt(match[2], 10) : 0
       // 尝试获取板块提示
       let tip = ''
       try {
         const descEl = await child.findElement(By.css('.chapter-desc'))
         tip = await descEl.getText()
       } catch { /* 无提示 */ }
       console.log(`# 板块：${group}（${count}题）`)
       currentSection = { group, count, tip, items: [], materials: [] }
       sections.push(currentSection)
       continue
     }

      // 判断是否含材料
      let hasMaterial = false
      try {
        await child.findElement(By.css('app-materials'))
        hasMaterial = true
      } catch { /* 不含材料 */ }

     if (hasMaterial) {
       const material = await this.extractMaterial(child, imageDir)
       collectImages(material)
       if (currentSection) {
         currentSection.materials = material
       }
       // 材料题组含多个 app-ti 子题
       const tiEls = await child.findElements(By.css('app-ti'))
       for (const tiEl of tiEls) {
         const article = await this.extractQuestion(tiEl, imageDir)
         collectImages(article.question)
         article.options.forEach(o => collectImages(o.content))
         collectImages(article.analysis)
         article.group = currentSection?.group ?? ''
         currentSection?.items.push(article)
         console.log(`第 ${article.rank} 题提取完成`)
       }
     } else {
       if (!currentSection) {
         currentSection = { group: '', count: 0, tip: '', items: [] }
         sections.push(currentSection)
       }
       const tiEls = await child.findElements(By.css('app-ti'))
       for (const tiEl of tiEls) {
         const article = await this.extractQuestion(tiEl, imageDir)
         collectImages(article.question)
         article.options.forEach(o => collectImages(o.content))
         collectImages(article.analysis)
         article.group = currentSection.group
         currentSection.items.push(article)
         console.log(`第 ${article.rank} 题提取完成`)
       }
     }
   }

   return {
      paper: {
        key,
        name,
       answerUrl: anwserUrl,
       crawledAt: this.formatTimestamp(new Date()),
     },
     sections,
     images,
   }
 }

  // ─── 专项练习（未完成） ───

  /** 格式化时间为 YYYY-MM-DD HH:mm:ss */
  private formatTimestamp(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  }

  async moduleAnswer(): Promise<void> {
    const driver = this.getDriver()
    await this.sleep()
    await driver.get(this.paperUrl)
    await this.sleep()

    const section = await this.findElement('//*[@id="calalog-page"]/main/div[1]/div[2]/app-keypoint-catalog/div/div[2]/ul')
    const contents = await section.findElements(By.css('li .keypoint-tree-title'))
    console.log('contents', contents.length)

    for (const item of contents) {
      await driver.executeScript<void>('arguments[0].click()', item)
    }
    await this.sleep(200)
  }
}

export default ChalkCrawler
