/**
 * 雪花算法（Snowflake）ID 生成器
 *
 * 64 位 ID 结构（Twitter Snowflake）：
 *   0 | 41 位毫秒时间戳 | 5 位数据中心 | 5 位机器 | 12 位序列号
 *
 * - 同一毫秒内通过序列号递增保证单机唯一
 * - 数据中心位 + 机器位保证分布式唯一
 * - ID 超过 JS 安全整数范围（2^53），统一以字符串形式返回，避免精度丢失
 */

/** 自定义起始时间戳（2024-01-01 00:00:00 UTC），用于缩小时间位 */
const EPOCH = 1704067200000

const DATACENTER_ID_BITS = 5
const WORKER_ID_BITS = 5
const SEQUENCE_BITS = 12

const MAX_DATACENTER_ID = -1 ^ (-1 << DATACENTER_ID_BITS) // 31
const MAX_WORKER_ID = -1 ^ (-1 << WORKER_ID_BITS) // 31
const SEQUENCE_MASK = -1 ^ (-1 << SEQUENCE_BITS) // 4095

const WORKER_ID_SHIFT = SEQUENCE_BITS
const DATACENTER_ID_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS
const TIMESTAMP_LEFT_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS + DATACENTER_ID_BITS

export interface SnowflakeOptions {
  /** 数据中心 ID（0-31），默认 0 */
  datacenterId?: number
  /** 机器 ID（0-31），默认 0 */
  workerId?: number
}

export class Snowflake {
  private readonly datacenterId: number
  private readonly workerId: number
  private sequence = 0
  private lastTimestamp = -1

  constructor(options: SnowflakeOptions = {}) {
    const { datacenterId = 0, workerId = 0 } = options
    if (datacenterId < 0 || datacenterId > MAX_DATACENTER_ID) {
      throw new Error(`datacenterId 超出范围 [0, ${MAX_DATACENTER_ID}]`)
    }
    if (workerId < 0 || workerId > MAX_WORKER_ID) {
      throw new Error(`workerId 超出范围 [0, ${MAX_WORKER_ID}]`)
    }
    this.datacenterId = datacenterId
    this.workerId = workerId
  }

  /** 生成下一个全局唯一 ID（字符串） */
  nextId(): string {
    let timestamp = Date.now()
    if (timestamp < this.lastTimestamp) {
      throw new Error(
        `时钟回拨：当前 ${timestamp} 早于上次 ${this.lastTimestamp}，拒绝生成 ID`,
      )
    }
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & SEQUENCE_MASK
      if (this.sequence === 0) {
        // 当前毫秒序列号耗尽，自旋等待到下一毫秒
        timestamp = this.waitNextMillis(this.lastTimestamp)
      }
    } else {
      this.sequence = 0
    }
    this.lastTimestamp = timestamp

    const id =
      (BigInt(timestamp - EPOCH) << BigInt(TIMESTAMP_LEFT_SHIFT)) |
      (BigInt(this.datacenterId) << BigInt(DATACENTER_ID_SHIFT)) |
      (BigInt(this.workerId) << BigInt(WORKER_ID_SHIFT)) |
      BigInt(this.sequence)
    return id.toString()
  }

  /** 自旋等待到下一毫秒 */
  private waitNextMillis(lastTimestamp: number): number {
    let timestamp = Date.now()
    while (timestamp <= lastTimestamp) {
      timestamp = Date.now()
    }
    return timestamp
  }
}

/** 默认单例，进程内复用 */
export const snowflake = new Snowflake()

export default snowflake
