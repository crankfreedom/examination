import { By, type WebElement } from "selenium-webdriver";
import { WebCrawler } from "@/utils/web-crawler";
import { chalkConfig } from "@/modules/chalk/config";
import { ChalkLogin } from "../services/chalk-login";
import type { ContentBlock, RichOption, QuestionData, KeypointItem, SectionData, ImageMeta, SmartPaperJSON } from "../types";

export class ChalkCrawler extends WebCrawler {
  private readonly loginService: ChalkLogin;
  private paperUrl: string = "https://www.fenbi.com/spa/tiku/guide/catalog/xingce?prefix=xingce";
  /** 图片保存目录，由调用方通过 setImageDir 设置，提取题目时复用，避免逐方法透传 */
  private imageDir: string = "";

  constructor() {
    super();
    this.loginService = new ChalkLogin(this);
  }

  /** 初始化 WebDriver（使用 chalk 配置的浏览器） */
  async init(): Promise<void> {
    await super.init(chalkConfig.browser);
  }

  // ─── 登录 ───

  /** 委托通用登录服务执行粉笔网登录 */
  async login(): Promise<void> {
    await this.loginService.login();
  }

  /** 设置图片保存目录，提取题目前由调用方设置一次即可，内部各方法复用 */
  setImageDir(dir: string): void {
    this.imageDir = dir;
  }

  // ─── 题目提取 ───

  private async checkQuestionType(el: WebElement): Promise<"single" | "multiple" | null> {
    /*
      题目类型
        single - 单题类型
        multiple - 复合类型
    */
    // 复合题容器内也含 app-ti，必须先判断 multiple，避免误判为 single
    try {
      await el.findElement(By.css(":scope > app-resizable > .resizable-container"));
      return "multiple";
    } catch {
      /* 非复合题 */
    }
    try {
      await el.findElement(By.css(":scope > .questions-single-container > app-ti"));
      return "single";
    } catch {
      /* 非单题 */
    }
    return null;
  }

  private async extractSingleQuestion(el: WebElement): Promise<QuestionData> {
    const headContainer = await el.findElement(By.css("app-ti .ti-container .title > .title-left"));
    // 题目角标
    const indexEl = await headContainer.findElement(By.css(".title-index"));
    const rank = parseInt((await indexEl.getText()).replace(".", ""), 10) || 0;
    // 题目类型
    const anwserTypeEl = await headContainer.findElement(By.css(".title-type-name"));
    const anwserType = await anwserTypeEl.getText();

    // 获取题干
    const contentEl = await el.findElement(By.css("app-ti > .ti-container > .ti-content > app-solution-choice > .solution-choice-container > app-question-choice"));
    const questionEl = await contentEl.findElement(By.css(".question-choice-container app-format-html"));
    const question = await this.getRichContent(questionEl, this.imageDir);

    // 获取可选项
    const optionEls = await contentEl.findElements(By.css("app-choice-radio .choice-radios > li"));
    const options: RichOption[] = [];
    for (const opt of optionEls) {
      const prexEl = await opt.findElement(By.css(".input-radio"));
      const label = await prexEl.getText();
      let textEl: WebElement;
      try {
        textEl = await opt.findElement(By.css(".input-text"));
      } catch {
        textEl = await opt.findElement(By.css("app-format-html"));
      }
      const optContent = await this.getRichContent(textEl, this.imageDir);
      options.push({ label, content: optContent });
    }

    // 答案部分
    const anwserEl = await el.findElement(By.css("app-ti > .ti-container > .ti-content > app-solution-choice > .solution-choice-container"));
    // 正确答案
    const correctEl = await anwserEl.findElement(By.css("app-solution-overall .correct-answer"));
    const answer = await correctEl.getText();

    // 易错项（可能不存在）
    let easyWrongAnswer = "";
    try {
      const easyWrongEl = await anwserEl.findElement(By.css("app-solution-overall .error-prone"));
      easyWrongAnswer = await easyWrongEl.getText();
    } catch {
      /* 无易错项 */
    }

    // 解析（富文本）
    let analysis: ContentBlock[] = [];
    try {
      const analysisEl = await anwserEl.findElement(By.css('section[id^="section-solution-"] .content'));
      analysis = await this.getRichContent(analysisEl, this.imageDir);
    } catch {
      /* 无解析 */
    }

    // 考点（支持多个）
    const kpNameEls = await anwserEl.findElements(By.css('section[id^="section-keypoint-"] .solution-keypoint-item-name'));
    const keypoints: KeypointItem[] = [];
    for (const nameEl of kpNameEls) {
      const title = await nameEl.getText();
      keypoints.push({ title, detail: "", frequency: 5 });
    }

    // 来源
    let source = "";
    try {
      const originEl = await anwserEl.findElement(By.css('section[id^="section-source-"] .content'));
      source = await originEl.getText();
    } catch {
      /* 无来源 */
    }

    return {
      rank,
      questionType: 'single',
      anwserType,
      group: "",
      question,
      options,
      answer,
      easyWrongAnswer,
      analysis,
      keypoints,
      source,
    };
  }

  private async extractMultipleQuestion(el: WebElement): Promise<{ label: string; questionType: 'multiple', materials: ContentBlock[]; items: QuestionData[] }> {
    const container = await el.findElement(By.css(":scope > app-resizable > .resizable-container"));

    // 左侧材料
    const leftContainer = await container.findElement(By.css(":scope > .left > .left-section > .left-part > app-materials > .materials-container > .material-body"));
    const labelEl = await leftContainer.findElement(By.css(":scope > a.label-tab"));
    const label = await labelEl.getText();
    const materialEl = await leftContainer.findElement(By.css(":scope > div.material-content"));
    const materials = await this.getRichContent(materialEl, this.imageDir);

    // 右侧题列表
    const rightContainer = await container.findElement(By.css(":scope > .right > .right-section > .right-part > .questions-container"));
    const itemEls = await rightContainer.findElements(By.css(":scope > app-ti"));
    const items: QuestionData[] = [];
    for (const itemEl of itemEls) {
      const item = await this.extractSingleQuestion(itemEl);
      items.push(item);
    }

    // 左侧材料
    /*
    const leftContainer = await container.findElement(By.css(":scope > .left > .left-section > .left-part > app-materials > .materials-container > .material-body"));
    const labelEl = await leftContainer.findElement(By.css(":scope > a.label-tab"));
    const label = await labelEl.getText();
    const materialEl = await leftContainer.findElement(By.css(":scope > div.material-content"));
    const materials = await this.getRichContent(materialEl, this.imageDir);

    // 右侧题列表
    const rightContainer = await container.findElement(By.css(":scope > .right > .right-section > .right-part > .questions-container"));
    const itemEls = await rightContainer.findElements(By.css(":scope > app-ti"));
    const items: QuestionData[] = [];
    for (const itemEl of itemEls) {
      const item = await this.extractSingleQuestion(itemEl);
      items.push(item);
    }

    */

    return { label, questionType: 'multiple', materials, items };
  }

  // ─── 智能组卷 ───
  async scrawlSmartPaper(): Promise<SmartPaperJSON> {
    const driver = this.getDriver();
    await this.sleep();

    // await driver.get(this.paperUrl);
    await driver.get("https://spa.fenbi.com/ti/exam/solution/1_1_3o8ceka?routecs=xingce");
    await this.sleep();

    const scrawlStartAt = this.formatTimestamp(new Date());

    // // 点击智能组卷
    // await this.clickElement(
    //   '//*[@id="calalog-page"]/main/div[1]/div[1]/fb-tiku-catalog/div/ul/li[3]/div',
    // );
    // await this.sleep();
    // // 点击生成试卷按钮
    // await this.clickElement(
    //   "/html/body/app-customize-smart-question/div/div/footer/button[2]",
    // );
    // // 等待试卷元素出现
    // await this.findElement("/html/body/app-root/app-exercise");

    const pageUrl = await driver.getCurrentUrl();
    const key = pageUrl.split("/").reverse()[1] ?? "";
    console.log("pageUrl", pageUrl);
    console.log("key", key);

    // // 提交试卷
    // await this.sleep();
    // // 点击交卷按钮
    // await this.clickElement(
    //   "/html/body/app-root/app-exercise/app-nav-header/header/div/div[3]/div",
    // );
    // await this.sleep();
    // // 二次确认交卷
    // await this.clickElement(
    //   "/html/body/app-root/app-modal-common/div/div/div[2]/button[2]",
    // );
    // await this.sleep(5000);

    // 等待答案结果页面出现
    // await this.findElement(
    //   "/html/body/app-root/app-solution/div/app-report-overall",
    // );
    const anwserUrl = await driver.getCurrentUrl();
    console.log("anwserUrl", anwserUrl);

    // 获取标题
    const headerEl = await this.findElement("body > app-root > app-solution > app-nav-header > header > div > div.header-title", "css");
    const name = await headerEl.getText();

    // 清理干扰元素
    await this.deleteElement("app-report-overall", "css");

    // ─── 逐题提取（含板块和材料题分组） ───
    const container = await this.findElement("app-tis > .tis-container", "css");
    const children = await container.findElements(By.xpath("./*"));
    console.log("children count", children.length);

    const sections: SectionData[] = [];
    let currentSection: SectionData | null = null;
    const images: ImageMeta[] = [];

    // 收集富文本中的图片元信息，统一写入 images 数组供下游渲染引用
    const collectImages = (blocks: ContentBlock[]) => {
      for (const b of blocks) {
        if (b.type === "image") {
          images.push({
            id: b.id,
            filename: `${b.id}.png`,
            width: b.width,
            height: b.height,
          });
        }
      }
    };

    for (const child of children) {
      const childrenClassName = await child.getAttribute("class");
      console.log("childrenClassName", childrenClassName);
      const isGroupName = childrenClassName?.includes?.("chapter-container");

      // 板块标题：每个板块新建独立 section，避免共享引用导致数据相互覆盖
      if (isGroupName) {
        const nameNumEl = await child.findElement(By.css(".chapter-name"));
        const nameNumText = await nameNumEl.getText();
        const numEl = await child.findElement(By.css(".chapter-name > .chapter-num"));
        const numText = await numEl.getText();
        const group = nameNumText.replace(numText, "").trim();
        const descEl = await child.findElement(By.css(".chapter-desc"));
        const tip = await descEl.getText();
        currentSection = {
          group,
          count: parseInt(numText.replace(/\D/g, ""), 10) || 0,
          tip,
          items: [],
          materials: [],
        };
        sections.push(currentSection);
        continue;
      }

      // 题目详情：单题直接入 items；复合题将材料挂到 section，子题逐一入 items
      const qType = await this.checkQuestionType(child);
      if (qType === null) continue;
      if (!currentSection) {
        currentSection = {
          group: "",
          count: 0,
          tip: "",
          items: [],
          materials: [],
        };
        sections.push(currentSection);
      }

      if (qType === "single") {
        const q = await this.extractSingleQuestion(child);
        collectImages(q.question);
        q.options.forEach((o) => collectImages(o.content));
        collectImages(q.analysis);
        currentSection.items.push(q);
      } else if (qType === "multiple") {
        const multi = await this.extractMultipleQuestion(child);
        collectImages(multi.materials);
        if (multi.materials.length) currentSection.materials = multi.materials;
        for (const item of multi.items) {
          collectImages(item.question);
          item.options.forEach((o) => collectImages(o.content));
          collectImages(item.analysis);
          currentSection.items.push(item);
        }
      }
    }

    return {
      paper: {
        key,
        name,
        anwserUrl,
        scrawlStartAt,
        crawledEndAt: this.formatTimestamp(new Date()),
      },
      sections,
      images,
    };
  }

  // ─── 专项练习（未完成） ───

  /** 格式化时间为 YYYY-MM-DD HH:mm:ss */
  private formatTimestamp(date: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }

  async moduleAnswer(): Promise<void> {
    const driver = this.getDriver();
    await this.sleep();
    await driver.get(this.paperUrl);
    await this.sleep();

    const section = await this.findElement('//*[@id="calalog-page"]/main/div[1]/div[2]/app-keypoint-catalog/div/div[2]/ul');
    const contents = await section.findElements(By.css("li .keypoint-tree-title"));
    console.log("contents", contents.length);

    for (const item of contents) {
      await driver.executeScript<void>("arguments[0].click()", item);
    }
    await this.sleep(200);
  }
}

export default ChalkCrawler;
