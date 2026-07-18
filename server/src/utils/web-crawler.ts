import { Builder, By, until, type WebDriver, type WebElement, type Locator } from 'selenium-webdriver'
import Save from '@/utils/save'
import * as chrome from 'selenium-webdriver/chrome'
import type { ContentBlock } from '@/modules/chalk/types'

/** 元素截图返回信息 */
export interface ScreenshotResult {
  name: string
  width: number
  height: number
}

/**
 * 通用网页爬取基类，封装 Selenium WebDriver 的常用页面操作。
 * 业务模块继承此类即可复用爬取能力，只需关注自身业务逻辑。
 */
export class WebCrawler {
  protected driver: WebDriver | null = null
  protected save: Save

  constructor() {
    this.save = new Save()
  }

  /** 等待指定毫秒 */
  sleep(duration = 2000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, duration))
  }

  /** 初始化 WebDriver，browser 默认 chrome */
  async init(browser = 'chrome'): Promise<void> {
    const builder = new Builder().forBrowser(browser)
    // Chrome 使用独立 user-data-dir，避免与用户日常浏览器冲突导致僵尸进程
    if (browser === 'chrome') {
      const opts = new chrome.Options()
        .addArguments('--no-first-run', '--no-default-browser-check', '--disable-extensions')
        .addArguments(`--user-data-dir=${require('node:os').tmpdir()}/selenium-chrome-profile`)
      builder.setChromeOptions(opts as any)
    }
    this.driver = builder.build()
  }

  /** 确保 driver 已初始化 */
  protected getDriver(): WebDriver {
    if (!this.driver) {
      throw new Error('WebDriver 未初始化，请先调用 init()')
    }
    return this.driver
  }

  /** 导航到指定 URL */
  async navigate(url: string): Promise<void> {
    await this.getDriver().get(url)
  }

  /** 最大化浏览器窗口 */
  async maximizeWindow(): Promise<void> {
    await this.getDriver().manage().window().maximize()
  }

  // ─── 页面操作辅助方法 ───

  /** 根据类型将选择器字符串转为 Selenium Locator */
  protected resolveLocator(selector: string, type: string): Locator {
    switch (type) {
      case 'xpath': return By.xpath(selector)
      case 'css': return By.css(selector)
      case 'id': return By.id(selector)
      case 'className': return By.className(selector)
      default: return By.xpath(selector)
    }
  }

  /** 查找某个元素（等待最多 50s） */
  async findElement(selector: string, type = 'xpath'): Promise<WebElement> {
    const driver = this.getDriver()
    const locator = this.resolveLocator(selector, type)
    await driver.wait(until.elementLocated(locator), 50000)
    return driver.findElement(locator)
  }

  /** 点击某个元素 */
  async clickElement(selector: string, type = 'xpath'): Promise<void> {
    const button = await this.findElement(selector, type)
    await this.getDriver().executeScript<void>('arguments[0].click()', button)
  }

  /** 填写输入框 */
  async fillElement(selector: string, value: string, type = 'xpath'): Promise<void> {
    const input = await this.findElement(selector, type)
    await input.sendKeys(value)
  }

  /** 隐藏某个元素 */
  async deleteElement(selector: string, type = 'xpath'): Promise<void> {
    const element = await this.findElement(selector, type)
    await this.getDriver().executeScript<void>('arguments[0].style.display="none"', element)
  }

  /** 设置页面 Cookies */
  async setCookies(): Promise<void> {
    const driver = this.getDriver()
    const cookies = await driver.manage().getCookies()
    for (const cookie of cookies) {
      const { name, value, ...extra } = cookie
      const options = Object.entries(extra).map(([k, v]) => `${k}=${v}`)
      const curCookie = `${name}=${value};${options.join(';')}`
     await driver.executeScript<void>('document.cookie = arguments[0]', curCookie)
   }
 }

  /** 读取当前页面的全部 localStorage，返回键值对对象 */
  async getLocalStorage(): Promise<Record<string, string>> {
    const driver = this.getDriver()
    return driver.executeScript<Record<string, string>>(`
      const result = {}
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (key !== null) {
          result[key] = window.localStorage.getItem(key) ?? ''
        }
      }
      return result
    `)
  }

  /** 读取当前页面 localStorage 中指定 key 的值，不存在时返回 null */
  async getLocalStorageItem(key: string): Promise<string | null> {
    const driver = this.getDriver()
    return driver.executeScript<string | null>(
      'return window.localStorage.getItem(arguments[0])',
      key,
    )
  }

  /** 对元素截图并保存 */
  async getImage(element: WebElement, dir: string): Promise<ScreenshotResult> {
    const driver = this.getDriver()
    await driver.executeScript<void>('arguments[0].scrollIntoView()', element)
    await this.sleep(400)
    const { width, height } = await element.getRect()
    const base64 = await element.takeScreenshot()
    const name = this.save.saveImage({ base64, dir: `${dir}/image` })
    return { name, width, height }
  }

  /** 提取元素 innerHTML，分离图片和文本 */
  async getHTML(element: WebElement): Promise<string> {
    const innerHTML = await element.getAttribute('innerHTML')
    if (!innerHTML) return ''
    const images = innerHTML.match(/<img.*?src=.*?>/g) ?? []
    const parts = innerHTML.replace(/<img.*?src=.*?>/g, '|[image]|').split('|')
    let index = 0
    return parts
      .map((part) => {
        if (part === '[image]') {
          const img = images[index]
          index++
          return img ? img.replace(/src.*data-/, '') : ''
        }
        return part
      })
      .join('')
  }

  /**
   * 遍历 DOM 子树，按顺序提取文本和图片，生成富文本内容块数组。
   * 每张 img 元素截图保存为 PNG，记录宽高信息。
   */
  async getRichContent(element: WebElement, imageDir: string): Promise<ContentBlock[]> {
    const driver = this.getDriver()
    const imgElements = await element.findElements(By.css('img'))
    const blockInfos = await driver.executeScript<Array<{
      type: 'text' | 'image'
      value?: string
      imageIndex?: number
    }>>(`
      const el = arguments[0]
      const result = []
      let imgIdx = 0
      function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent
          if (t && t.trim()) { result.push({ type: 'text', value: t }) }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'IMG') { result.push({ type: 'image', imageIndex: imgIdx++ }) }
          else { for (const child of node.childNodes) { walk(child) } }
        }
      }
      walk(el)
      return result
    `, element)
    const blocks: ContentBlock[] = []
    for (const info of blockInfos) {
      if (info.type === 'text') {
        blocks.push({ type: 'text', value: info.value! })
      } else {
        const imgEl = imgElements[info.imageIndex!]
        if (imgEl) {
          const { name, width, height } = await this.getImage(imgEl, imageDir)
          blocks.push({ type: 'image', id: name, width, height })
        }
      }
    }
    return blocks
  }

  /** 关闭浏览器 */
  async quit(): Promise<void> {
    await this.driver?.quit()
  }
}

export default WebCrawler
