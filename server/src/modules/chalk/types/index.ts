import type { WebDriver, WebElement } from 'selenium-webdriver'

/** 富文本内容块：纯文本 */
export interface TextBlock {
  type: 'text'
  value: string
}

/** 富文本内容块：图片引用 */
export interface ImageBlock {
  type: 'image'
  id: string
  width: number
  height: number
}

/** 富文本内容块联合类型 */
export type ContentBlock = TextBlock | ImageBlock

/** 选项（含富文本） */
export interface RichOption {
  label: string
  content: ContentBlock[]
}

/** 单道题目数据 */
export interface QuestionData {
  rank: number
  questionType: 'single' | 'multiple'
  anwserType: string
  group: string
  question: ContentBlock[]
  options: RichOption[]
  answer: string
  easyWrongAnswer: string
  analysis: ContentBlock[]
  keypoints: KeypointItem[]
  source: string
}

/** 考点条目 */
export interface KeypointItem {
  title: string
  detail: string
  frequency: number
}

/** 板块数据 */
export interface SectionData {
  group: string
  count: number
  tip: string
  items: QuestionData[]
  materials?: ContentBlock[]
}

/** 图片元数据 */
export interface ImageMeta {
  id: string
  filename: string
  width: number
  height: number
}

/** 完整的智能组卷 JSON 输出 */
export interface SmartPaperJSON {
  paper: {
    key: string
    name: string
    anwserUrl: string
    scrawlStartAt: string
    crawledEndAt: string
    /** 兼容旧数据：早期生成的试卷仅记录 crawledAt */
    crawledAt?: string
  }
  sections: SectionData[]
  images: ImageMeta[]
}

/** 题目选项 */
export interface ExamOption {
  prex: string
  text: string
}

/** 解析详情（多条段落） */
export interface ExamAnalysisDetail {
  name: string
  value: string[]
}

/** 考点 */
export interface ExamKeypoint {
  name: string
  value: string
}

/** 来源 */
export interface ExamOrigin {
  name: string
  value: string
}

/** 单条统计项 */
export interface ExamStatistic {
  key: string
  value: string
}

/** 统计分组 */
export interface ExamStatisticGroup {
  name: string
  value: ExamStatistic[]
}

/** 答案解析聚合 */
export interface ExamAnalysis {
  analysis: ExamAnalysisDetail
  keypoint: ExamKeypoint
  origin: ExamOrigin
  statistic: ExamStatisticGroup
}

/** 单道题目完整数据 */
export interface ExamArticle {
  rank: string
  type: string
  materialTitle: string
  materials: string[]
  question: string[]
  options: ExamOption[]
  correct: string
  analysis: ExamAnalysis
}

/** 整套试卷采集结果 */
export interface ExamPaper {
  key: string
  name: string
  pageUrl: string
  anwserUrl: string
  articles: ExamArticle[]
}

export type ChalkDriver = WebDriver
export type ChalkElement = WebElement
