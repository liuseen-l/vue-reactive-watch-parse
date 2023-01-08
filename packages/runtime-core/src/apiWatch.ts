import { Ref, ComputedRef, isRef, isReactive, isShallow, ReactiveFlags, EffectScheduler, ReactiveEffect } from "@vue/reactivity"
import { EMPTY_OBJ, hasChanged, isArray, isFunction, isMap, isObject, isPlainObject, isSet, NOOP, remove } from "@vue/shared"
import { currentInstance } from "./component"
import { callWithAsyncErrorHandling, callWithErrorHandling, ErrorCodes } from "./errorHandling"
import { queueJob, queuePostFlushCb, SchedulerJob } from "./scheduler"


export type WatchEffect = (onCleanup: OnCleanup) => void

export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onCleanup: OnCleanup
) => any

type MapSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
  ? Immediate extends true
  ? V | undefined
  : V
  : T[K] extends object
  ? Immediate extends true
  ? T[K] | undefined
  : T[K]
  : never
}

type OnCleanup = (cleanupFn: () => void) => void

export interface WatchOptionsBase {
  flush?: 'pre' | 'post' | 'sync'
}

export interface WatchOptions<Immediate = boolean> extends WatchOptionsBase {
  immediate?: Immediate
  deep?: boolean
}

export type WatchStopHandle = () => void

type MultiWatchSources = (WatchSource<unknown> | object)[]

// overload: array of multiple sources + cb
export function watch<
  T extends MultiWatchSources,
  Immediate extends Readonly<boolean> = false
>(
  sources: [...T],
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: multiple sources w/ `as const`
// watch([foo, bar] as const, () => {})
// somehow [...T] breaks when the type is readonly
export function watch<
  T extends Readonly<MultiWatchSources>,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<MapSources<T, false>, MapSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: single source + cb
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

// overload: watching reactive object w/ cb
export function watch<
  T extends object,
  Immediate extends Readonly<boolean> = false
>(
  source: T,
  cb: WatchCallback<T, Immediate extends true ? T | undefined : T>,
  options?: WatchOptions<Immediate>
): WatchStopHandle

/**
 * 
 * 实际上，watch 的实现本质上就是利用了 effect 以及options.scheduler 选项，如以下代码所示：
    effect(() => {
        console.log(obj.foo)
      }, {
        scheduler() {
        // 当 obj.foo 的值变化时，会执行 scheduler 调度函数
      }
    })
 */


export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
): WatchStopHandle {

  // 判断传入的 scheduler调度器，是否为一个函数
  if (!isFunction(cb)) {
    console.warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
      `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
      `supports \`watch(source, cb, options?) signature.`
    )
  }
  return doWatch(source as any, cb, options)
}

const INITIAL_WATCHER_VALUE = {}

// function watch(source, cb) {
//   // 定义 getter
//   let getter
//   // 如果 source 是函数，说明用户传递的是 getter，所以直接把 source 赋
//   值给 getter
//   if (typeof source === 'function') {
//     getter = source
//   } else {
//     // 否则按照原来的实现调用 traverse 递归地读取
//     getter = () => traverse(source)
//   }
//   effect(
//     // 执行 getter
//     () => getter(),
//     {
//       scheduler() {
//         cb()
//       }
//     }
//   )
// }


// run 是收集依赖，并将监听的 source 作为 oldValue或newValue
// scheduler 内部执行job ，job 执行实际就是执行 cb
// source 可以是一个getter函数 也可以是一个响应式对象
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallback | null,
  { immediate, deep, flush }: WatchOptions = EMPTY_OBJ
): WatchStopHandle {
  if (!cb) {

    if (immediate !== undefined) {
      console.warn(
        `watch() "immediate" option is only respected when using the ` +
        `watch(source, callback, options?) signature.`
      )
    }
    if (deep !== undefined) {
      console.warn(
        `watch() "deep" option is only respected when using the ` +
        `watch(source, callback, options?) signature.`
      )
    }
  }

  const warnInvalidSource = (s: unknown) => {
    console.warn(
      `Invalid watch source: `,
      s,
      `A watch source can only be a getter/effect function, a ref, ` +
      `a reactive object, or an array of these types.`
    )
  }

  // 获取当前的vue实例
  const instance = currentInstance

  // getter 作为传给 effect 的 fn
  let getter: () => any
  let forceTrigger = false
  // 数组的一个判断
  let isMultiSource = false

  // 首先判断传入的值是不是 ref 实例
  if (isRef(source)) {
    getter = () => source.value
    // 如果是浅层次响应那么 forceTrigger 为 true
    forceTrigger = isShallow(source)
  }
  // 然后判断传入的值是不是 reactive 实例
  else if (isReactive(source)) {
    // 注意，这里没有调用traverse去建立依赖关系
    getter = () => source
    // 默认开启深度监听
    deep = true
  } else if (isArray(source)) {
    // 如果传入的是数组，多源设置为真
    isMultiSource = true
    // 只要数组当中有一个元素是 reactive 实例，或者是浅层次的响应式，就会将 forceTrigger 设置为真
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    // 使数组当中的元素和effect建立依赖关系，保证数组当中元素的变化能够触发 watch 的 cb 执行
    getter = () => source.map(s => {
      if (isRef(s)) {
        // 如果数组元素是ref实例，直接访问value属性就可以收集依赖，因此访问的位置处于 effect 当中
        return s.value
      }
      else if (isReactive(s)) {
        // 如果数组元素是 reactive 实例，那么调用 traverse 深度遍历，这里和上面的isReactive判断有点差异，上面是没有进行深度遍历的
        return traverse(s)
      } else if (isFunction(s)) {
        // 如果元素是函数，表明我们要监听一个函数，调用 callWithErrorHandling，当中会调用s()，并返回调用的结果，如果s()调用过程中也涉及到响应式对象，么就会与effect建立依赖关系
        return callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
      } else {
        warnInvalidSource(s)
      }
    })
  }
  // 如果传入的值是一个函数，在函数内部，用户可以指定该 watch 依赖哪些响应式数据，只有当这些数据变化时，才会触发回调函数执行
  else if (isFunction(source)) {
    if (cb) {
      // 如果元素是函数，表明我们要监听一个函数，调用 callWithErrorHandling，当中会调用s()，并返回调用的结果，如果s()调用过程中也涉及到响应式对象，那么就会与effect建立依赖关系
      getter = () => callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
    } else {
      // 如果调用 watch的时候，没有传入回调函数 scheduler 
      // no cb -> simple effect
      getter = () => {
        if (instance && instance.isUnmounted) {
          return
        }
        if (cleanup) {
          cleanup()
        }
        return callWithAsyncErrorHandling(
          source,
          instance,
          ErrorCodes.WATCH_CALLBACK,
          [onCleanup]
        )
      }
    }
  } else {
    // 如果不是响应式对象，也不是函数，那么不进行监听
    getter = NOOP
    warnInvalidSource(source)
  }

  // 这里可以弥补传入的值是一个响应式对象的时候，比如 reactive 实例，我们在上方进行判断的时候是没有进行 traverse 的
  // 而且也只有在第一次判断 reactive 实例的时候加了deep = true
  if (cb && deep) {
    const baseGetter = getter // getter = () => source
    // 这里不知道谁他妈设计的，真脑瘫，给爷恶心坏了   
    getter = () => traverse(baseGetter()) // baseGetter()，返回的是 source
  }
  // 以上的代码都是为收集依赖做铺垫


  let cleanup: () => void
  let onCleanup: OnCleanup = (fn: () => void) => {
    cleanup = effect.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // INITIAL_WATCHER_VALUE = {} ，如果不是数组，那么 oldValue 初始化就等于一个{ },如果是数组，那么 oldValue 中每一个元素值都赋值为 { }
  let oldValue: any = isMultiSource ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE

  const job: SchedulerJob = () => {
    if (!effect.active) {
      return
    }
    // 如果watch有传入回调函数
    if (cb) {
      // watch(source, cb)
      // 这里调用 effect.run 方法，获取到run方法执行完毕后的返回值，实际就是 watch 监听的对象（source）
      const newValue = effect.run()
      // 
      if (deep || forceTrigger || (isMultiSource ? (newValue as any[]).some((v, i) => hasChanged(v, (oldValue as any[])[i]))
        : hasChanged(newValue, oldValue))
      ) {
        // cleanup before running cb again
        if (cleanup) {
          cleanup()
        }
        // 在这里执行cb，也就是传入给 watch 的回调函数，而 cb 中的 3个参数，就是这里传入的第四个参数，是一个数组，数组一个3个值，就是给cb传入的3个参数
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK,
          [newValue,
            // pass undefined as the old value when it's changed for the first time
            // 假如通过 immediate 开启的立即执行，那么此时的 oldValue === INITIAL_WATCHER_VALUE，第一次回调执行时没有所谓的旧值，因此此时回调函数的oldValue 值为 undefined，因此在这里进行一个旧值的赋值
            oldValue === INITIAL_WATCHER_VALUE ? undefined : (isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE) ? [] : oldValue,
            onCleanup
          ])
        // 当前执行完毕之后的新值作为下一次执行的旧值
        oldValue = newValue
      }
    } else {
      // watchEffect
      effect.run()
    }
  }

  // important: mark the job as a watcher callback so that scheduler knows
  // it is allowed to self-trigger (#1727) 
  job.allowRecurse = !!cb

  let scheduler: EffectScheduler
  /**
    直接执行 job 函数，这本质上相当于 'sync' 的实现机制，即同步执
    行。对于 options.flush 的值为 'pre' 的情况，我们暂时还没有办
    法模拟，因为这涉及组件的更新时机，其中 'pre' 和 'post' 原本的
    语义指的就是组件更新前和更新后 
    sync立即执行 -> pre更新之前 -> post更新之后，默认现在是 pre
  */
  if (flush === 'sync') {
    scheduler = job as any // 立即执行
  }
  // flush 本质上是在指定调度函数的执行时机，当 flush 的值为 'post' 时，代表调度函数需要将副作用函数放到一个微任务队列中，并等待 DOM 更新结束后再执行
  else if (flush === 'post') {
    scheduler = () => queuePostFlushCb(job)
  } else {
    // 默认为pre
    job.pre = true
    // 这个instance用来判断是组件使用还是用户调用，我们在这里只考虑用户调用的情况
    // if (instance) 
    //    job.id = instance.uid

    // 当 wacth 监听的数据发生变化的时候，就会执行 scheduler，内部调用 queueJob，内部再调用 queueFlush，内部再调用 flushJobs，然后执行 job，job 实际上就是回调函数的执行
    // 为什么要将 scheduler 抽离成 job，因为用户可能开启了 immediate 属性，需要立即执行回调函数，而 job 内部就封装了回调函数的执行，如果开启了该属性。只需调用 job() 即可
    scheduler = () => queueJob(job)
  }

  // 核心调用 effect ，传入 getter 作为fn
  const effect = new ReactiveEffect(getter, scheduler)

  // initial run
  if (cb) {
    // 如果开启了 immediate，job，内部会立即执行一次effect.run，run方法执行的是传给 ReactiveEffect 的 fn，在这里就是 getter
    if (immediate) {
      job()
    } else {
      // 执行effect，进行依赖的收集，这里返回的就是监听的对象，即 source
      oldValue = effect.run()
    }
  } else if (flush === 'post') {
    queuePostFlushCb(effect.run.bind(effect))
  } else {
    effect.run()
  }

  const unwatch = () => {
    effect.stop()
    if (instance && instance.scope) {
      remove(instance.scope.effects!, effect)
    }
  }

  return unwatch
}

/**
  在 watch 内部的 effect 中调用 traverse 函数进行递归的读取操作，代替硬编码的方式，这样就能读取一个对
  象上的任意属性，从而当任意属性发生变化时都能够触发回调函数执行。
 */
export function traverse(value: unknown, seen?: Set<unknown>) {
  // 如果要读取的数据是原始值，或者当前的value是跳过代理的，那么什么都不做
  if (!isObject(value) || (value as any)[ReactiveFlags.SKIP]) {
    return value
  }
  seen = seen || new Set()
  // 如果已经被读取过，也什么都不做
  if (seen.has(value)) {
    return value
  }
  // 将数据添加到 seen 中，代表遍历地读取过了，避免循环引用引起的死循环
  seen.add(value)
  // 判断是否为 ref 实例
  if (isRef(value)) {
    // 如果 value 是 ref 的实例，那么调用 value 获取当中的值，然后通过 traverse 进行处理
    traverse(value.value, seen)
  } else if (isArray(value)) {
    // 如果 value 是一个数组，遍历元素调用 traverse 进行处理
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (isSet(value) || isMap(value)) {
    // 如果 value 是一个Set集合或者Map集合，使用 forEach 读取每一个值，并递归地调用 traverse 进行处理
    value.forEach((v: any) => {
      traverse(v, seen)
    })
  } else if (isPlainObject(value)) {
    // 如果 value 就是一个对象，使用 for...in 读取对象的每一个值，并递归地调用 traverse 进行处理
    for (const key in value) {
      traverse((value as any)[key], seen)
    }
  }
  return value
}
