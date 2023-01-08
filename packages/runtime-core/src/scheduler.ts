import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'
import { ComponentInternalInstance } from './component'

export interface SchedulerJob extends Function {
  id?: number
  pre?: boolean
  active?: boolean
  computed?: boolean
  allowRecurse?: boolean
  ownerInstance?: ComponentInternalInstance
}

export type SchedulerJobs = SchedulerJob | SchedulerJob[]

let isFlushing = false
let isFlushPending = false

const queue: SchedulerJob[] = []
let flushIndex = 0

const pendingPostFlushCbs: SchedulerJob[] = []
let activePostFlushCbs: SchedulerJob[] | null = null
let postFlushIndex = 0

const resolvedPromise = /*#__PURE__*/ Promise.resolve() as Promise<any>
let currentFlushPromise: Promise<void> | null = null


export function nextTick<T = void>(
  this: T,
  fn?: (this: T) => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}


// 直接执行job
export function queueJob(job: SchedulerJob) {
  /**
    重复数据删除搜索使用 Array.include（） 的 startIndex 参数
    默认情况下，搜索索引包括正在运行的当前作业
    因此，它不能再次递归触发自身。
    如果作业是 watch（） 回调，则搜索将以 +1 索引开始
    允许它递归触发自身 - 用户有责任
    确保它不会陷入无限循环。
   */
  if (!queue.length || !queue.includes(job, isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex)) {
    // 如果是用户调用
    if (job.id == null) {
      queue.push(job)
    }
    queueFlush()
  }
}

// dom更新完毕执行job
export function queuePostFlushCb(cb: SchedulerJobs) {
  if (!isArray(cb)) {
    if (!activePostFlushCbs || !activePostFlushCbs.includes(cb, cb.allowRecurse ? postFlushIndex + 1 : postFlushIndex)) {
      pendingPostFlushCbs.push(cb)
    }
  } else {
    pendingPostFlushCbs.push(...cb)
  }
  queueFlush()
}

function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

const getId = (job: SchedulerJob): number => job.id == null ? Infinity : job.id

function flushJobs() {
  isFlushPending = false
  isFlushing = true

  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job && job.active !== false) {
        // 这当中会执行 job
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }
    }
  } finally {
    flushIndex = 0
    queue.length = 0

    // 在 dom 渲染之后执行的 job
    flushPostFlushCbs()

    isFlushing = false
    currentFlushPromise = null

    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs()
    }

  }
}

export function flushPostFlushCbs() {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    // #1947 already has active queue, nested flushPostFlushCbs call
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped


    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
      activePostFlushCbs[postFlushIndex]()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}


