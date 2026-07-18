/**
 * 异步互斥锁：将异步任务串行化，用于保护不可并发执行的资源
 * （如共用 Chrome user-data-dir 的 PDF 生成、写同一文件等）。
 *
 * 特性：
 * - 串行：后到的 run 调用等待前一个结束（成功或失败）再开始，不会死锁。
 * - 可观测：isLocked 反映是否有任务正在执行或排队。
 * - 忙碌即拒：tryRun 在有任务进行中时立即返回 null，便于接口层返回“忙碌”提示。
 *
 * 用法：每个需要串行的接口/资源创建独立实例（模块级常量），
 *   在 handler 中用 run / tryRun 包裹临界区。
 *
 * @example
 *   const pdfMutex = createMutex()
 *   // 策略一：排队等待（后到的请求 pending 直到前一个结束）
 *   const result = await pdfMutex.run(() => generatePdf(id))
 *   // 策略二：忙碌即拒（立即返回，客户端可轮询重试）
 *   const p = pdfMutex.tryRun(() => generatePdf(id))
 *   if (!p) return failRes({ code: CODE.RATE_LIMIT, message: '正在生成中，请稍后' })
 *   const result = await p
 */
export interface Mutex {
  /** 串行执行任务：后到的等待前一个结束再开始；前一个失败也会放行下一个 */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** 尝试执行：若有任务进行中则返回 null（调用方可返回“忙碌”），否则立即开始执行 */
  tryRun<T>(task: () => Promise<T>): Promise<T> | null;
  /** 是否有任务正在执行或排队 */
  readonly isLocked: boolean;
}

/** 创建一个互斥锁实例。每个需要串行的接口/资源应使用独立实例。 */
export function createMutex(): Mutex {
  let lock: Promise<void> = Promise.resolve();
  let depth = 0;

  async function run<T>(task: () => Promise<T>): Promise<T> {
    const prev = lock;
    let release!: () => void;
    // 同步换上新锁（必须在 await 之前），保证并发到达的调用正确串成一条链
    lock = new Promise<void>((resolve) => (release = resolve));
    depth++;
    try {
      await prev;
      return await task();
    } finally {
      depth--;
      release();
    }
  }

  function tryRun<T>(task: () => Promise<T>): Promise<T> | null {
    // run 内 depth 在首个 await 前同步自增，check 与 acquire 之间无 await，天然原子
    if (depth > 0) return null;
    return run(task);
  }

  return {
    run,
    tryRun,
    get isLocked() {
      return depth > 0;
    },
  };
}
