import { TrackOpTypes, TriggerOpTypes } from './operations'
import { createDep, Dep, finalizeDepMarkers, initDepMarkers, newTracked, wasTracked } from './dep'
import { isArray, extend, isMap, isIntegerKey } from '@vue/shared'
import { ComputedRefImpl } from './computed'

// run 方法的执行，就是 lazy = true 的实现
let effectTrackDepth = 0

export let trackOpBit = 1

const maxMarkerBits = 30

/**
 * effect1(()=>{
 *    state.name
 *    effect2(()=>{
 *      state.age
 *    })
 *    state.slary
 * })
 * 
 * effect1 -> name slary
 * effect2 -> age
 * 
 * 用栈来处理，存储正确的关系
 */
export type EffectScheduler = (...args: any[]) => any

// 修改
// let effectDeep = 0; 
// export let effectDeepStack: Array<ReactiveEffect>[] | null = [] 

// 原始
// let effectStack: ReactiveEffect[] = [] 
export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol('iterate')
// // * TODO: review 
// 修改
// export const ARR_VALUE_ITERATE_KEY = Symbol('iterate')
export const MAP_KEY_ITERATE_KEY = Symbol('Map key iterate')

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 修改
// function cleanupChildrenEffect(effect: ReactiveEffect) {
//   // 当前触发父effect重新执行，这意味着内层的effect都会执行一遍，为了防止收集重复的依赖，那么可以在这里将内层依赖进行递归清空（下一层）依赖清空  
//   for (let i = 0; i < effect.childEffects.length; i++) {
//     cleanupEffect(effect.childEffects[i])
//     effect.childEffects.shift()
//   }
// }
function cleanupEffect(effect: ReactiveEffect) {
  // deps 是当前副作用函数身上的一个属性，这个属性中存储了那些object.key收集了当前effect所对应的set集合
  const { deps } = effect // deps -> [set,set]
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      // 重新执行副作用函数的时候，将当前副作用函数从这个 deps 当中删除
      deps[i].delete(effect)
    }
    deps.length = 0
  }

  // 修改
  // if (effect.childEffects.length > 0) {
  //   cleanupChildrenEffect(effect)
  // }
}

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = [] // 让 effect 记录他依赖了哪些属性，同时要记录当前属性依赖了哪个effect 
  parent: ReactiveEffect | undefined = undefined
  // childEffects: ReactiveEffect[] = []
  computed?: ComputedRefImpl<T>
  onStop?: () => void
  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: any
  ) {
  }

  run() {
    // 如果不是激活状态
    if (!this.active) {
      return this.fn()
    }

    // 如果是嵌套的effect，最外层的parent是undefined，第二层的parent是上一层的effect
    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    // 上来更新 deps 当中 dep 的dep.w , track 更新 dep.n
    /**
         * 
         *  let obj = reactive({a:1,b:2,c:3})
         *  
         *  effect(()=>{
         *    // 执行到这里的时候 trackOpBit = 2 , effectTrackDepth = 1
         *    obj.a
         *    // 执行到这里 dep1.n = 0000 0010 , dep1.w = 0000 0000，执行完毕之后 deps1.length = 1
         *    effect(()=>{ 
         *        // 执行到这里的时候 trackOpBit = 4 , effectTrackDepth = 2
         *        obj.b
         *        // 执行到这里 dep2.n = 0000 0100, dep2.w = 0000 0000，执行完毕之后 deps2.length == 1
         *    }) // 执行完毕之后，trackOpBit = 2 , effectTrackDepth = 1，dep1.n = 0000 0010, dep1.w = 0000 0000，
         * 
         *    // 执行到这里的时候 trackOpBit = 2 , effectTrackDepth = 1, dep1.n = 0000 0010 , dep1.w = 0000 0000
         *    obj.c
         *    // 执行到这里 dep3.n = 0000 0010, dep3.w = 0000 0000，执行完毕之后 deps1.length = 2
         *  })
         * 
         * 当 obj.a 的值发生变化的时候，重新执行最外层的 effect
         *  effect(()=>{ // deps1.length = 2
         *    // 执行到这里的时候 trackOpBit = 2 , effectTrackDepth = 1
         *    // 这一次会走 initDepMarks() 当中的for循环，去设置 dep1.w 的值 ，dep1.w |= trackOpBit = 0000 0010, dep3.w |= trackOpBit = 0000 0010,
         *    obj.a
         *    // 执行到这里 dep1.n = 0000 0010 ，dep1.w = 0000 0010, 通过调用 wasTracked(dep) 进行判断，判断结果设置 shouldTrack = false, deps1.length == 1
         *    effect(()=>{ // 这里会新创建一个effect 
         *        // 执行到这里的时候 trackOpBit = 4 , effectTrackDepth = 2
         *        // 由于是新创建的，所以deps2.length == 0 ,因此不走initDepMarks当中的for循环
         *        obj.b
         *        // 执行到这里 dep2.n = 0000 0100, dep2.w = 0000 0000，执行完毕之后 deps2.length == 1
         * 
         *    }) // 执行完毕之后，trackOpBit = 2 , effectTrackDepth = 1，dep1.n = 0000 0010, dep1.w = 0000 0010，dep3.w = 0000 0010
         * 
         *    // 执行到这里的时候 trackOpBit = 2 , effectTrackDepth = 1, dep1.n = 0000 0010, dep1.w = 0000 0010, dep3.w = 0000 0010
         *    obj.c
         *    // 执行到这里 dep3.n = 0000 0010 ，dep3.w = 0000 0010, 通过调用 wasTracked(dep) 进行判断，判断结果设置 shouldTrack = false, deps1.length == 2
         *  })
         * 
         *  位运算实际上就是对依赖清除方式的一个优化，以前的话，每一次调用run方法，进入到这个函数当中时，就会去调用cleanupEffect函数去清空依赖，这样会有一个问题
         *  就是有可能很多依赖，在这一次的trigger的过程中，会有很多之前被清空的依赖再次被收集，这样就产生了很多没有必要的删除操作，因此通过位运算进行标记，在effect执行完毕后
         *  根据这些标记，再进行选择性的删除，这样避免了很多不必要的这个删除操作，因此删除的操作次数是小于等于之前一进来就删除所有依赖的操作次数
         */
    try {
      this.parent = activeEffect // 刚开始的activeEffect是undefined
      activeEffect = this
      shouldTrack = true

      // 一来 trackOpBit 变成了2 ，effectTrackDepth 变成了 1
      trackOpBit = 1 << ++effectTrackDepth // 1 向左移动 effectTrackDepth+1 位，数值扩大 (effectTrackDepth+1)*2 倍， 例如 5 << 2 == 20 , 5 << 1 == 10

      // 1 <= 30
      if (effectTrackDepth <= maxMarkerBits) {
        // 一开始走这里，但是 deps.length = 0,没有什么操作，但是第二次执行的时候 deps.length = 1，deps[i].w |= trackOpBit 等于了 0000 0010，这是最简单的情况
        initDepMarkers(this)
      } else {
        cleanupEffect(this)
      }
      return this.fn()  // run 完之后，dep.n 变成 0000 0010
    } finally {
      if (effectTrackDepth <= maxMarkerBits) {
        finalizeDepMarkers(this)
      }
      // 执行完毕之后 trackOpBit 变成了 1,effectTrackDepth 变成了 0
      trackOpBit = 1 << --effectTrackDepth

      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined
    }
  }

  // 清除依赖关系，可以手动调用stop执行
  stop() {
    if (this.active) // 如果effect是激活的采取将deps上的effect移除
    {
      cleanupEffect(this)
      // 如果 watch 当中涉及竞态问题，那么可以在这里执行 onStop,而 onStop 的执行实际上是执行用户传入给 onCleanup 的过期回调
      if (this.onStop) {
        this.onStop()
      }
      this.active = false // 关闭当前effect的激活状态
    }

  }
}

type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

export function isTracking() {
  return activeEffect !== undefined
}

// 追踪 一个属性对应多个effect 多个属性对应一个effect
export function track(target: object, key: unknown, type?: TrackOpTypes) {
  // 判断这个 state.name 访问属性的操作是不是在 effect 中执行的，简单来说就是判断需不需要收集
  if (!isTracking() || !shouldTrack) { //如果这个属性不依赖于 effect 直接跳出
    return
  }

  // 根据 target 从 '桶' 当中取得depsMap ,他是一个 Map 类型: key -> effetcs
  // 这行代码的含义就是从桶（大桶）当中拿出 target 对象所有字段的副作用函数集合（所有小桶）  
  let depsMap = targetMap.get(target)

  //如果当前target对象还没有它的大桶，就创建大桶
  if (!depsMap) {
    depsMap = new Map()
    targetMap.set(target, depsMap)
  }

  //这行代码的含义是，如果当前target对象有桶（大桶），那么从所有字段的副作用函数集合（所有小桶）中，取出当前key的副作用函数集合（小桶）
  let dep = depsMap.get(key)

  if (!dep) {
    // 创建当前字段装副作用函数的小桶
    dep = createDep()
    depsMap.set(key, dep)
  }

  trackEffects(dep)
}

// 第二个参数用来debugger，这里我们用不到先跳过
export function trackEffects(dep: Dep) {
  // 判断当前的副作用函数是否已经被收集过，收集过就不用再收集了，虽然set可以过滤重复的，但还是有效率问题
  // 原始
  // let shouldTrack = !dep.has(activeEffect!)

  let shouldTrack = false
  if (effectTrackDepth <= maxMarkerBits) {
    if (!newTracked(dep)) {
      // 对 n 的操作
      dep.n |= trackOpBit // set newly tracked  开始的时候 n = 0000 0000 | 0000 0010 变成 0000 0010
      shouldTrack = !wasTracked(dep)       // 第一次的时候 shouldTrack = 0000 0000 & 0000 0010 变成 0000 0000 返回 false，第二次的时候 shouldTrack = 0000 0010 & 0000 0010 变成 0000 0010 > 0 返回 true 
    }
  } else {
    // Full cleanup mode.
    shouldTrack = !dep.has(activeEffect!)
  }

  if (shouldTrack) {
    dep.add(activeEffect)
    activeEffect!.deps.push(dep) // 副作用函数保存自己被哪些 target.key 所收集
  }
}

/**
 * @param target {Target }     
 * @param key   { string | number | symbol }
 * @param type  { TriggerOpTypes }  触发更新的操作，修改，删除，新增
 * @param newValue  { unknown }  用于修改 arr.length = xxx 的时候，此时的 key == 'length' 而 newValue 就是修改的长度的值 
 * @returns 
 */
export function trigger(target: object, key?: unknown, type?: TriggerOpTypes, newValue?: unknown) {
  // 设置新的值以后，取出当前target所对应的大桶
  const depsMap = targetMap.get(target)

  // 如果没有大桶直接返回,表明属性没有依赖任何的effect
  if (!depsMap)
    return;

  let deps: (Dep | undefined)[] = [] // [set,set]

  // 如果修改 arr.length，将索引大于等于 newValue(修改length的值) 的副作用函数取出来执行
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) {
    const newLength = Number(newValue)
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= newLength) {
        deps.push(dep)
      }
    })
  } else {
    // 执行 target key 的副作用函数
    if (key !== void 0) {
      // 这里有个问题,就是当前trigger是由于增添属性触发的时候,这里 target key 会获取到 undefined，set在删除属性这里也会拿到undefined，因为set没有get方法，因此没有元素和effect建立依赖关系
      deps.push(depsMap.get(key))
    }

    switch (type) {
      // 只有当操作类型为 'ADD' 时，才触发 target 身上 key == ITERATE_KEY 相关联的副作用函数重新执行
      case TriggerOpTypes.ADD:
        // 这里会进行不同的判断,因为保存增添操作所对应的副作用函数的标识符会根据数据类型不同而变化
        if (!isArray(target)) { // 如果增添属性的对象是普对对象,取出for in的副作用函数
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) { // 如果增添属性的对象是Map对象,取出Map所对应的for...of keys()副作用函数
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        /**
         *    这里为什么还需要 isIntergerKey 去判断 key 是否为符合数组的索引类型?
         *    因为 TriggerOpTypes.ADD 只是确认了当前的属性为新增属性,当走到 else if (isIntegerKey(key)) 的时候
         *    只能说明 target 是数组类型,但是不能确保key是不是符合数组的索引属性,因此需要判断一下
         *  */
        else if (isIntegerKey(key)) { // 如果为数组新增元素，应该触发与length相关的副作用函数
          deps.push(depsMap.get('length'))
        }
        break
      // 只有当操作类型为 'DELETE' 时，才触发 target 身上 key == ITERATE_KEY 相关联的副作用函数重新执行
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) { // 如果删除属性的对象是Map对象,取出Map所对应的for...of keys()副作用函数
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        // 由于 Map 的 forEach 可以访问key 和 value，因此set操作，需要将 ITERATE_KEY 收集的依赖拿出来执行
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  // 如果 deps 的长度为1，直接传入deps[0]
  if (deps.length === 1) {
    if (deps[0]) {
      triggerEffects(deps[0])
    }
  } else {
    const effects: ReactiveEffect[] = []
    for (const dep of deps) { // dep -> set
      // 防止当前trigger是由于增添属性触发的时候,上面 deps.push(depsMap.get(key)) 会添加 undefined 到deps里面
      if (dep) {
        effects.push(...dep)
      }
    }
    triggerEffects(createDep(effects))
    // triggerEffects(effects)
  }
}

export function triggerEffects(
  dep: Dep | ReactiveEffect[],
) {
  // 老问题出现了，因为我们传入的dep是Dep，一个set集合，遍历的时候执行run，run中将当前的effect从dep中删除，但是重新执行又添加进去，导致死循环
  const effects = isArray(dep) ? dep : [...dep]

  // 遍历副作用函数，每次执行更详细的trigger前需要先判断当前的effect是否为计算属性的
  //  先触发计算属性的副作用函数
  for (const effect of effects) {
    if (effect.computed) {
      triggerEffect(effect)
    }
  }

  for (const effect of effects) {
    if (!effect.computed) {
      triggerEffect(effect)
    }
  }
}

function triggerEffect(
  effect: ReactiveEffect,
) {
  // 防止 effect 中同时执行和赋值导致死循环
  if (effect !== activeEffect) {
    // 判断effect是否有调度器，比如计算属性就会传入这个属性，将控制权返回给用户
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}

// 副作用函数的构造函数
export function effect<T = any>(fn: () => T, options?: any) {

  // 检查当前的深度
  /**
   * 最外层的深度为0
   * 最外层执行完毕之后深度为1，那么在深度为1所执行的所有effect,都应该被存储到最外层的childEffects当中
   */

  const _effect = new ReactiveEffect(fn) // 这里导致嵌套函数有问题

  //合并
  if (options) {
    extend(_effect, options)
  }

  if (!options || !options.lazy) {
    _effect.run() // 默认让fn执行一次
  }

  const runner = _effect.run.bind(_effect)
  runner.effect = _effect // 给runner添加一个effect属性就是_effect实例
  // runner 可以强制重新执行effect
  return runner
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

// export class ReactiveEffect<T = any> {
//   active = true
//   deps: Dep[] = [] // 让 effect 记录他依赖了哪些属性，同时要记录当前属性依赖了哪个effect
//   parent: ReactiveEffect | undefined = undefined
//   // childEffects: ReactiveEffect[] = []
//   computed?: ComputedRefImpl<T>
//   constructor(
//     public fn: () => T,
//     public scheduler: any | null = null,
//     scope?: any
//   ) {
//   }

//   run() {
//     // 如果不是激活状态
//     if (!this.active) {
//       return this.fn()
//     }

//     /**
//      * 防止死循环，比如
//      * effect(()=>{
//      *    state.name = Math.Romdom()
//      * })
//      */

//     if (!effectStack.includes(this)) { // 屏蔽同一个effect会多次执行
//       try {

//         /**
//          * 执行传入给 effect 的 fn 函数的时候
//          * 将当前的 effect 保存在当前深度，开始深度为0
//          *  */
//         // if (!effectDeepStack[effectDeep]) {
//         //   effectDeepStack[effectDeep] = <ReactiveEffect[]>[]
//         //   effectDeepStack[effectDeep].push(this)
//         // } else {
//         //   effectDeepStack[effectDeep].push(this)
//         // }

//         // 激活状态的话，需要建立属性和依赖的关系
//         cleanupEffect(this) // 清空分支切换时遗留的副作用函数
//         activeEffect = this;
//         effectStack.push(activeEffect)

//         // 每次执行一次 effect 当中的 fn 意味着深度加1

//         // effectDeep++
//         return this.fn(); // 访问data的属性，触发getter （依赖收集）, 并返回getter的结果，在计算属性中 computed.value 可以拿到这个 getter 函数返回的值
//       } finally {
//         // effect 当中的 fn 执行完毕之后深度减1
//         // effectDeep--
//         // // 防止下标越界
//         // if (effectDeep > 0) {
//         //   for (let i = 0; i < effectDeepStack[effectDeep].length; i++) {
//         //     // 将下一层的effect保存在当前effect的child
//         //     effectDeepStack[effectDeep - 1][0].childEffects.push(effectDeepStack[effectDeep].pop())
//         //   }
//         // }
//         effectStack.pop() // 嵌套副作用函数执行完毕以后将最里层的副作用函数pop出去

//         activeEffect = effectStack[effectStack.length - 1]

//         //当最外层的effect执行完毕之后，将 effectDeepStack 清空
//         // if (!activeEffect)
//         //   effectDeepStack.length = 0
//       }
//     }
//   }

//   // 清除依赖关系，可以手动调用stop执行
//   stop() {
//     if (this.active) // 如果effect是激活的采取将deps上的effect移除
//     {
//       cleanupEffect(this)
//       this.active = false // 关闭当前effect的激活状态
//     }
//   }
// }
