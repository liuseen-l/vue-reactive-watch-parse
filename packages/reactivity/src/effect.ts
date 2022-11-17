import { TrackOpTypes, TriggerOpTypes } from './operations'
import { Target } from './reactive'
import { Dep } from './dep'
import { isArray, extend, isMap, isIntegerKey, toNumber } from '@vue/shared'
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
let effectStack: ReactiveEffect[] = []
export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol('iterate')
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
}

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = [] // 让 effect 记录他依赖了哪些属性，同时要记录当前属性依赖了哪个effect 
  parent: ReactiveEffect | undefined = undefined

  constructor(
    public fn: () => T,
    public scheduler: any | null = null,
    scope?: any
  ) {
  }

  run() {
    // 如果不是激活状态
    if (!this.active) {
      return this.fn()
    }

    /**
     * 防止死循环，比如
     * effect(()=>{
     *    state.name = Math.Romdom()
     * })
     */

    if (!effectStack.includes(this)) { // 屏蔽同一个effect会多次执行 
      try {
        // 激活状态的话，需要建立属性和依赖的关系
        cleanupEffect(this) // 清空分支切换时遗留的副作用函数
        activeEffect = this;
        effectStack.push(activeEffect)
        return this.fn(); // 访问data的属性，触发getter （依赖收集）
      } finally {
        effectStack.pop() // 嵌套副作用函数执行完毕以后将最里层的副作用函数pop出去
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  }

  // 清除依赖关系，可以手动调用stop执行
  stop() {
    if (this.active) // 如果effect是激活的采取将deps上的effect移除
    {
      cleanupEffect(this)
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
    dep = new Set()
    depsMap.set(key, dep)
  }

  trackEffects(dep)
}

export function trackEffects(dep: Dep) {
  // 判断当前的副作用函数是否已经被收集过，收集过就不用再收集了，虽然set可以过滤重复的，但还是有效率问题
  let shouldTrack = !dep.has(activeEffect)

  // 如果是内层的effect 我们可以将之前的先清空掉
  // if (effectStack.length === 1) {
  //   dep.clear()
  // }

  if (shouldTrack) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep) // 副作用函数保存自己被哪些 target.key 所收集
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
  if (key === 'length' && isArray(target)) {
    const newLength = toNumber(newValue)
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
          if (isMap(target)) { // // 如果增添属性的对象是Map对象,取出Map所对应的for in副作用函数
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        /**
         *  这里为什么还需要 isIntergerKey 去判断 key 是否为符合数组的索引类型?
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
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }


  const effects: ReactiveEffect[] = []
  for (const dep of deps) { // dep -> set
    // 防止当前trigger是由于增添属性触发的时候,上面 deps.push(depsMap.get(key)) 会添加 undefined 到deps里面
    if (dep) {
      effects.push(...dep)
    }
  }

  triggerEffects(effects)
}

export function triggerEffects(dep: Dep | ReactiveEffect[]) {
  // 老问题出现了，因为我们传入的dep是Dep，一个set集合，遍历的时候执行run，run中将当前的effect从dep中删除，但是重新执行又添加进去，导致死循环
  const effects = isArray(dep) ? dep : [...dep]
  for (const effect of effects) {
    // 防止 effect 中同时执行和赋值导致死循环
    if (effect !== activeEffect) {
      if (effect.scheduler) {
        return effect.scheduler()
      }
      effect.run()
    }
  }
}

// 副作用函数的构造函数
export function effect<T = any>(fn: () => T, options?: any) {

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



