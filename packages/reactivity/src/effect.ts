import { TrackOpTypes } from './operations'

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
let effectStack = []
export let activeEffect: ReactiveEffect | undefined


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
     * 
     * 防止死循环，比如
     * effect(()=>{
     *    state.name = Math.Romdom()
     * })
     * 
     * 
     */

    if (!effectStack.includes(this)) { // 屏蔽同一个effect会多次执行 
      try {
        // 激活状态的话，需要建立属性和依赖的关系
        activeEffect = this;
        effectStack.push(activeEffect)
        return this.fn(); // 访问data的属性，触发getter （依赖收集）
        // activeEffect = effectStack.pop()
      } finally {
        effectStack.pop() // 嵌套副作用函数执行完毕以后将最里层的副作用函数pop出去
        activeEffect = effectStack[effectStack.length - 1]
      }
    }

  }

  stop() {

  }
}


const targetMap = new WeakMap();


export function isTracking() {
  return activeEffect !== undefined
}

// 追踪 一个属性对应多个effect 多个属性对应一个effect
export function track(target: object, key: unknown) {

  // 判断这个 state.name 访问属性的操作是不是在 effect 中执行的，简单来说就是判断需不需要收集
  if (!isTracking()) { //如果这个属性不依赖于 effect 直接跳出
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
  let deps = depsMap.get(key)

  if (!deps) {
    // 创建当前字段装副作用函数的小桶
    deps = new Set()
    depsMap.set(key, deps)
  }

  // 判断当前的副作用函数是否已经被收集过，收集过就不用再收集了，虽然set可以过滤重复的，但还是有效率问题
  let shouldTrack = deps.has(activeEffect)
  if (shouldTrack) {
    deps.add(activeEffect)
    activeEffect.deps.push(deps) // 副作用函数保存自己被哪些 target.key 所收集
  }


}

export function effect<T = any>(fn: () => T, options?) {

  const _effect = new ReactiveEffect(fn)

  _effect.run() // 默认让fn执行一次
}



export type Dep = Set<ReactiveEffect> & TrackedMarkers

type TrackedMarkers = {
  w: number
  n: number
}