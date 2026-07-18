import { chalkConfig } from '@/modules/chalk/config'
import type { WebCrawler } from '@/utils/web-crawler'

/**
 * Chalk 模块通用登录服务
 * 封装粉笔网账号密码登录流程，供 chalk 模块下各爬虫复用。
 */
export class ChalkLogin {
  private baseUrl: string = 'https://www.fenbi.com/page/home'

  constructor(private readonly crawler: WebCrawler) { }

  /** 执行粉笔网账号密码登录，登录后自动保存 Cookies */
  async login(): Promise<void> {
    const { username, password } = chalkConfig

    await this.crawler.navigate(this.baseUrl)
    await this.crawler.maximizeWindow()

    // 检测登录状态
    const haslogined = await this.isLogined()
    console.log('haslogined', haslogined)
    if (!haslogined) {
      await this.crawler.clickElement('button.login-button', 'css')
      await this.crawler.sleep()
      await this.crawler.clickElement("//span[contains(text(),'账号密码登录')]")
      await this.crawler.sleep()
      await this.crawler.fillElement('input.fenbi-login-modal-form-input[type="text"]', username, 'css')
      await this.crawler.fillElement('input.fenbi-login-modal-form-input[type="password"]', password, 'css')
      await this.crawler.clickElement('.fenbi-login-modal-agreement-checkbox', 'css')
      await this.crawler.clickElement('.fenbi-login-modal-form-button', 'css')
    } else {
      console.log('用户已登录, 无需重复执行登录操作')
    }

    await this.crawler.sleep()
    await this.crawler.setCookies()
  }

  async isLogined(): Promise<boolean> {
    const userinfoString = await this.crawler.getLocalStorageItem('userinfo')
    const userinfo = JSON.parse(userinfoString || '{}')
    const { username } = chalkConfig
    return userinfo.name === username
  }
}

export default ChalkLogin
