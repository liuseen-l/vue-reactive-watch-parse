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

// 存放 flush = pre | sync 的 job
const queue: SchedulerJob[] = []
let flushIndex = 0

// 存放 flush = post 的 job
const pendingPostFlushCbs: SchedulerJob[] = []
let postFlushIndex = 0

let activePostFlushCbs: SchedulerJob[] | null = null

const resolvedPromise = /*#__PURE__*/ Promise.resolve() as Promise<any>
let currentFlushPromise: Promise<void> | null = null


type CountMap = Map<SchedulerJob, number>

export function nextTick<T = void>(
  this: T,
  fn?: (this: T) => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

// 当 watch 设置为 pre 的时候执行的，这个和组件的渲染有关，不太好展示
export function flushPreFlushCbs(
  // if currently flushing, skip the current job itself
  i = isFlushing ? flushIndex + 1 : 0
) {
  for (; i < queue.length; i++) {
    // cb 实际上就是 job
    const cb = queue[i]
    if (cb && cb.pre) {
      queue.splice(i, 1)
      i--
      cb()
    }
  }
}

function findInsertionIndex(id: number) {
  // the start index should be `flushIndex + 1`
  let start = flushIndex + 1
  let end = queue.length

  while (start < end) {
    const middle = (start + end) >>> 1
    const middleJobId = getId(queue[middle])
    middleJobId < id ? (start = middle + 1) : (end = middle)
  }

  return start
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
    } else {
      // 组件更新触发的该函数和watch flush = pre | post 都走这里，插入之前，需要调整顺序，确保缓存队列中id的顺序是递增的，在调整的过程会发现，组件的更新job会排在在watch的job的前面
      queue.splice(findInsertionIndex(job.id), 0, job)
    }
    queueFlush()
  }
}

// dom 更新完毕执行 job
export function queuePostFlushCb(cb: SchedulerJobs) {
  if (!isArray(cb)) {
    if (!activePostFlushCbs || !activePostFlushCbs.includes(cb, cb.allowRecurse ? postFlushIndex + 1 : postFlushIndex)) {
      // dom 渲染之后执行的 job 队列
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
    // pre 和 post 都是放到微任务队列，那么 flush 为 sync 的函数是处于同步任务的，会先执行，即使先更新pre的数据再更新sync的数据也是如此，因为js引擎机制是固定的
    // 然后内部再以  pre,onBeforeUpdate  -> 真实dom更新完毕 -> post,onUpdate  的顺序去执行
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

const getId = (job: SchedulerJob): number => job.id == null ? Infinity : job.id

// 当 flush = pre 或者 post 才会执行这个函数
function flushJobs(seen: CountMap) {
  // 等待中
  isFlushPending = false
  // 清空中
  isFlushing = true

  {
    seen = seen || new Map();
  }

  // 检查递归更新
  const check = (job: SchedulerJob) => checkRecursiveUpdates(seen, job)
  try {
    // 这当中会执行 job,当flush = pre 的时候，job就是这里执行的，执行完 watch 的 pre job 之后，onUpdated就开始执行，onUpdated 的回调函数也在 queue 中
    // 虽然 preJob 先执行了，也就是数据已经发生了变化，但是还没有渲染真实 dom ，因此这里如果显示数据会更新，但是访问dom还是没有更新，vue数据更新是同步的，dom更新是异步的（需要进行虚拟dom比较操作再更新）
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job && job.active !== false) {
        if (check(job)) {
          continue
        }
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }

    }
  } finally {
    // 重置 job 访问下标
    flushIndex = 0
    // 清空 queue 队列中的 job
    queue.length = 0

    // 在 dom 渲染之后执行的 job
    flushPostFlushCbs(seen)

    isFlushing = false
    currentFlushPromise = null

    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs(seen)
    }
  }
}
export function flushPostFlushCbs(seen: CountMap) {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    // #1947 already has active queue, nested flushPostFlushCbs call
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    {
      seen = seen || new Map()
    }

    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    // 执行 watch 中 flush = post 的回调函数
    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      if (checkRecursiveUpdates(seen!, activePostFlushCbs[postFlushIndex])) {
        continue
      }
      activePostFlushCbs[postFlushIndex]()
    }

    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

const RECURSION_LIMIT = 100
function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      return true
    } else {
      seen.set(fn, count + 1)
    }
  }
}
