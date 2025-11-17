import { useIntervalFn, useOnline, useStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

// 常量定义
const STORAGE_KEY = 'countdown-sync-state'
const MAX_TIMESTAMP_DEVIATION = 300_000 // 5分钟(ms)
const MS_PER_SECOND = 1000
const MAX_CACHE_AGE = 24 * 60 * 60 * MS_PER_SECOND // 24小时(ms)
const MAX_FUTURE_TIME = 365 * 24 * 60 * 60 * MS_PER_SECOND // 1年(ms)
const SECOND_TIMESTAMP_THRESHOLD = 1e12 // 时间戳单位判断阈值
const WEAK_NETWORK_TIMEOUT = 15000 // 3G超时时间(15秒)
const RETRY_DELAY = [1000, 3000, 5000] // 重试延迟
const MAX_RETRIES = 3 // 最大重试次数
const REQUEST_DELAY_TOLERANCE = 2000 // 允许的请求延迟容忍度(2秒)

export function useCountdownSync(options = {}) {
  const isClient = import.meta.client
  const {
    normalSyncInterval = 60_000,
    fastSyncInterval = 5_000,
    requestTimeout = WEAK_NETWORK_TIMEOUT,
  } = { ...options }

  // 状态管理
  const online = useOnline()
  const storage = useStorage(STORAGE_KEY, null)

  // 核心时间状态（新增请求发送时间，用于修正延迟）
  const serverEndTime = ref(null)
  const serverNow = ref(null)
  const clientNow = ref(null)
  const requestSendTime = ref(null) // 记录请求发送时的客户端时间
  const isTimestampValid = ref(true)

  // 展示状态
  const remaining = ref(0)
  const isExpired = ref(false)
  const syncing = ref(false)
  const errorMessage = ref(null)
  const debugInfo = ref({})
  const retryCount = ref(0)
  const isSyncDisabled = ref(false)

  /**
   * 时间戳单位转换（统一毫秒）
   */
  const normalizeTimestamp = (timestamp) => {
    return timestamp < SECOND_TIMESTAMP_THRESHOLD
      ? timestamp * MS_PER_SECOND
      : timestamp
  }

  /**
   * 时间戳有效性校验（新增请求延迟修正）
   */
  const validateTimestamps = (endTime, nowTime) => {
    // 基础校验
    if (!endTime || !nowTime || Number.isNaN(endTime) || Number.isNaN(nowTime) || endTime <= 0 || nowTime <= 0) {
      errorMessage.value = '无效的时间戳（非数字或负值）'
      return false
    }

    // 单位统一
    const normalizedEnd = normalizeTimestamp(endTime)
    const normalizedNow = normalizeTimestamp(nowTime)
    const timeDiff = normalizedEnd - normalizedNow

    // 逻辑校验
    if (timeDiff < -MAX_TIMESTAMP_DEVIATION) {
      errorMessage.value = `结束时间已过期（${Math.abs(Math.floor(timeDiff / MS_PER_SECOND))}秒）`
      return false
    }
    if (timeDiff > MAX_FUTURE_TIME) {
      errorMessage.value = '结束时间过于遥远（超过1年），可能为无效值'
      return false
    }

    // 关键修复：修正3G网络请求延迟导致的时间偏差
    if (requestSendTime.value) {
      const requestDelay = Date.now() - requestSendTime.value // 请求耗时
      // 如果请求耗时超过容忍度，修正服务器当前时间（补偿延迟）
      if (requestDelay > REQUEST_DELAY_TOLERANCE) {
        serverNow.value = normalizedNow + requestDelay // 服务器时间 = 响应时间 + 请求耗时
      }
      else {
        serverNow.value = normalizedNow
      }
      serverEndTime.value = normalizedEnd // 结束时间不受请求延迟影响
    }
    else {
      serverEndTime.value = normalizedEnd
      serverNow.value = normalizedNow
    }

    return true
  }

  /**
   * 更新剩余时间（防止回跳加时的核心逻辑）
   */
  const updateRemaining = () => {
    if (!isTimestampValid.value || !serverEndTime.value || !serverNow.value || !clientNow.value) {
      remaining.value = 0
      isExpired.value = true
      return
    }

    // 计算服务器当前时间（基于客户端时间差，避免重复加时）
    const clientTimeElapsed = Date.now() - clientNow.value
    const currentServerTime = serverNow.value + clientTimeElapsed

    // 关键修复：确保剩余时间只减不增（防止同步后突然加时）
    const newRemaining = serverEndTime.value - currentServerTime
    remaining.value = Math.max(0, Math.min(remaining.value || newRemaining, newRemaining))

    isExpired.value = remaining.value <= 0

    // 调试信息（便于排查延迟问题）
    debugInfo.value = {
      serverEndTime: serverEndTime.value,
      serverNow: serverNow.value,
      clientNow: clientNow.value,
      clientTimeElapsed,
      currentServerTime,
      newRemaining,
      requestDelay: requestSendTime.value ? Date.now() - requestSendTime.value : 0,
    }
  }

  /**
   * 使用缓存数据（避免缓存导致的时间偏差）
   */
  const useCachedData = () => {
    const cached = storage.value
    if (!cached || !cached.serverEndTime || !cached.serverNow || !cached.clientNow) {
      return false
    }

    // 缓存过期校验
    const cacheAge = Date.now() - cached.syncedAt
    if (cacheAge >= MAX_CACHE_AGE) {
      return false
    }

    // 关键修复：使用缓存时，重新计算客户端基准时间（避免缓存时间过时）
    const cachedServerNow = normalizeTimestamp(cached.serverNow)
    const cachedServerEnd = normalizeTimestamp(cached.serverEndTime)
    const cacheTimeElapsed = Date.now() - cached.clientNow // 缓存到现在的耗时
    const currentCachedServerTime = cachedServerNow + cacheTimeElapsed

    // 验证缓存的有效性（防止缓存导致的加时）
    if (cachedServerEnd - currentCachedServerTime < -MAX_TIMESTAMP_DEVIATION) {
      return false
    }

    serverEndTime.value = cachedServerEnd
    serverNow.value = cachedServerNow
    clientNow.value = Date.now() // 重置客户端基准时间
    return true
  }

  /**
   * 执行同步请求（记录发送时间）
   */
  const fetchSyncData = async () => {
    requestSendTime.value = Date.now()
    const controller = new AbortController()
    const { signal } = controller
    const timeoutTimer = setTimeout(() => controller.abort(), requestTimeout)

    try {
      const response = await fetch('/api/end-time', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // 手动设置请求头，避免低版本解析问题
        },
        body: JSON.stringify({ t: requestSendTime.value }),
        signal,
      })

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`)
      return await response.json()
    }
    finally {
      clearTimeout(timeoutTimer)
    }
  }

  /**
   * 带重试的同步逻辑
   */
  const syncWithRetry = async () => {
    try {
      const response = await fetchSyncData()
      retryCount.value = 0

      const serverEnd = response.e || response.serverEndTime
      const serverNow = response.s || response.serverNow

      if (validateTimestamps(serverEnd, serverNow)) {
        clientNow.value = Date.now() // 重置客户端基准时间（关键：避免累积偏差）
        // 更新缓存（存储原始时间戳，避免二次转换偏差）
        storage.value = {
          serverEndTime: serverEnd,
          serverNow,
          clientNow: clientNow.value,
          syncedAt: Date.now(),
        }
      }
      else if (!useCachedData()) {
        errorMessage.value += '，且缓存数据无效'
      }
    }
    catch (error) {
      const isTimeout = error.name === 'TimeoutError' || error.message.includes('timeout')
      const isAbort = error.name === 'AbortError'

      if (isAbort) {
        errorMessage.value = '同步已取消'
        return false
      }

      if (retryCount.value < MAX_RETRIES) {
        const delay = RETRY_DELAY[retryCount.value] || RETRY_DELAY[RETRY_DELAY.length - 1]
        errorMessage.value = `同步失败（${isTimeout ? '超时' : '网络异常'}），将在${delay / 1000}秒后重试（${retryCount.value + 1}/${MAX_RETRIES}）`

        retryCount.value += 1
        await new Promise(resolve => setTimeout(resolve, delay))
        return syncWithRetry()
      }
      else {
        errorMessage.value = `同步失败（已重试${MAX_RETRIES}次），将使用缓存数据`
        const cacheValid = useCachedData()
        if (!cacheValid) {
          errorMessage.value += '，但缓存也无效'
          isTimestampValid.value = false
        }
        retryCount.value = 0
      }
    }
    finally {
      requestSendTime.value = null // 重置请求发送时间
    }
  }

  /**
   * 对外暴露的同步方法（防止并发导致的时间冲突）
   */
  const syncNow = async () => {
    if (!isClient || syncing.value || isSyncDisabled.value)
      return

    isSyncDisabled.value = true
    syncing.value = true
    errorMessage.value = null

    // 关键修复：同步前记录当前剩余时间，用于后续防加时校验
    const preSyncRemaining = remaining.value

    try {
      await syncWithRetry()
      // 二次校验：如果同步后剩余时间比同步前多，说明有偏差，强制使用同步前的值
      if (remaining.value > preSyncRemaining && preSyncRemaining > 0) {
        remaining.value = preSyncRemaining
      }
    }
    finally {
      syncing.value = false
      setTimeout(() => { isSyncDisabled.value = false }, 1000)
      updateRemaining()
    }
  }

  /**
   * 倒计时分解
   */
  const parts = computed(() => {
    const totalSeconds = Math.floor(remaining.value / MS_PER_SECOND)
    return {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      milliseconds: Math.floor((remaining.value % MS_PER_SECOND) / 10),
    }
  })

  // 客户端初始化
  if (isClient) {
    // 100ms更新一次，避免视觉跳变
    useIntervalFn(updateRemaining, 100, { immediate: true })

    // 定期同步（避免频繁同步导致的偏差累积）
    useIntervalFn(() => {
      if (online.value && !isExpired.value) {
        syncNow()
      }
    }, () => isExpired.value ? fastSyncInterval : normalSyncInterval)

    // 挂载时初始化
    onMounted(() => {
      const cacheValid = useCachedData()
      updateRemaining()
      setTimeout(() => syncNow(), cacheValid ? 3000 : 0)
    })

    // 网络恢复同步
    watch(online, (newVal) => {
      if (newVal && isClient) {
        syncNow()
      }
    })

    // 关键修复：监听serverEndTime变化，防止突然加时
    watch(serverEndTime, (newVal, oldVal) => {
      if (oldVal && newVal && newVal > oldVal + MS_PER_SECOND * 2) {
        // 如果结束时间突然增加超过2秒，视为异常，回退到旧值
        serverEndTime.value = oldVal
        errorMessage.value = '检测到时间异常变动，已自动修正'
      }
    })
  }

  return {
    remaining,
    parts,
    isExpired,
    isTimestampValid,
    syncing,
    errorMessage,
    debugInfo,
    isSyncDisabled,
    syncNow,
  }
}
