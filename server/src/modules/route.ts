import type { Request, Response } from 'express'
import type { ApiResponse } from '@/utils/response'
import {
  useCreateSmartPaper,
  useSmartPaperCreatePdf,
  useSmartPaperDownload,
  useSmartPaperList,
} from '@/modules/chalk/controllers/create-smart-paper'

/** 支持的 HTTP 方法 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Controller 处理函数：执行业务逻辑并返回统一响应体，由 resWrapper 统一发送 */
export type RouteHandler = (req: Request, res: Response) => Promise<ApiResponse> | ApiResponse

/** 路由字典项（隶属于某个模块） */
export interface RouteItem {
  /** HTTP 方法 */
  method: HttpMethod
  /** 路由路径（不含模块前缀） */
  path: string
  /** Controller 处理函数 */
  handler: RouteHandler
  /** 接口描述 */
  desc?: string
}

/** 路由模块：一个模块前缀 + 该模块下的路由列表 */
export interface RouteModule {
  /** 模块前缀，挂载到 app.use 上 */
  module: string
  /** 该模块下的路由列表 */
  routes: RouteItem[]
}

/**
 * 路由字典表
 * 数组元素为各个模块，每个模块内挂自己的路由列表
 * app.ts 依据此表为每个模块创建独立 Router 并挂载
 * 新增接口只需在对应模块的 routes 下追加一条记录；新增模块则追加一个元素
 */
export const routeDict: RouteModule[] = [
  {
    module: '/chalk',
    routes: [
      { method: 'post', path: '/create/smart-paper', handler: useCreateSmartPaper, desc: '触发智能组卷采集' },
      { method: 'get', path: '/create/smart-paper', handler: useCreateSmartPaper, desc: '触发智能组卷采集' },
      { method: 'get', path: '/smart-paper/list', handler: useSmartPaperList, desc: '列出 smart-paper 目录下所有试卷文件夹信息' },
      { method: 'get', path: '/smart-paper/create-pdf', handler: useSmartPaperCreatePdf, desc: '按试卷文件夹名读取 index.ts 生成 PDF 试卷' },
      { method: 'get', path: '/smart-paper/download', handler: useSmartPaperDownload, desc: '按 id 下载试卷文件夹压缩包' },
    ],
  },
]
