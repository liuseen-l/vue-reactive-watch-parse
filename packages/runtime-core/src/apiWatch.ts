import { Ref, ComputedRef, isRef, isReactive, isShallow, ReactiveFlags, EffectScheduler, ReactiveEffect } from "@vue/reactivity"
import { EMPTY_OBJ, hasChanged, isArray, isFunction, isMap, isObject, isPlainObject, isSet, NOOP } from "@vue/shared"
import { currentInstance } from "./component"
import { callWithAsyncErrorHandling, callWithErrorHandling, ErrorCodes } from "./errorHandling"
import { SchedulerJob } from "./scheduler"


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
        // 如果数组元素是ref实例，直接访问value属性就可以收集依赖，因此访问的位置处于effect当中
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

  // 这里可以弥补传入的值是一个响应式对象的时候，比如 reactive 实例，我们在上方进行判断的时候是没有进行 traverse 的，而且也只有在第一次判断 reactive 实例的时候加了deep = true
  if (cb && deep) {
    const baseGetter = getter // getter = () => source
    // 这里不知道谁他妈设计的，真脑瘫，给爷恶心坏了   
    getter = () => traverse(baseGetter()) // baseGetter()，返回的是 source
  }

  let cleanup: () => void
  let onCleanup: OnCleanup = (fn: () => void) => {
    cleanup = effect.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  let oldValue: any = isMultiSource ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE
  
  const job: SchedulerJob = () => {
    if (!effect.active) {
      return
    }
    if (cb) {
      // watch(source, cb)
      const newValue = effect.run()
      if (deep || forceTrigger || (isMultiSource ? (newValue as any[]).some((v, i) => hasChanged(v, (oldValue as any[])[i]))
        : hasChanged(newValue, oldValue))
      ) {
        // cleanup before running cb again
        if (cleanup) {
          cleanup()
        }
        callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
          newValue,
          // pass undefined as the old value when it's changed for the first time
          oldValue === INITIAL_WATCHER_VALUE
            ? undefined
            : (isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE)
              ? []
              : oldValue,
          onCleanup
        ])
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
  if (flush === 'sync') {
    scheduler = job as any // the scheduler function gets called directly
  } else if (flush === 'post') {
    scheduler = () => queuePostRenderEffect(job, instance && instance.suspense)
  } else {
    // default: 'pre'
    job.pre = true
    if (instance) job.id = instance.uid
    scheduler = () => queueJob(job)
  }

  // 核心调用 effect ，传入 getter 作为fn
  const effect = new ReactiveEffect(getter, scheduler)


  // initial run
  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effect.run()
    }
  } else if (flush === 'post') {
    queuePostRenderEffect(
      effect.run.bind(effect),
      instance && instance.suspense
    )
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
