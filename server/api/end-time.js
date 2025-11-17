// /api/end-time.get.js
const ONE_DAY_MS = 1000 * 60 * 60 * 24

const fallbackEndTime = Date.now() + ONE_DAY_MS
const endTime = fallbackEndTime

export default defineEventHandler(async (event) => {
  // 弱网下简化处理逻辑，减少服务器响应时间
  try {
    // 超短超时（1.5秒），避免服务器端阻塞
    const timeoutId = setTimeout(() => {
      throw new Error('server_timeout')
    }, 1500)

    // 快速读取请求体（忽略复杂验证）
    const body = await readBody(event).catch(() => ({}))
    const clientSendTime = body.t || Date.now() // 兼容简化参数名

    // 直接返回时间戳（避免复杂计算）
    const serverNow = Date.now()
    // 你的结束时间（建议从内存缓存中获取，避免IO操作）
    const serverEndTime = endTime

    clearTimeout(timeoutId)
    // 极简响应体，减少传输数据量
    return { s: serverNow, e: serverEndTime, t: clientSendTime }
  }
  catch (error) {
    // 弱网下即使出错也返回最小化响应，避免客户端无响应
    setResponseStatus(event, error.message === 'server_timeout' ? 504 : 500)
    return { err: error.message || 'err' }
  }
})
