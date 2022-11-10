import { isObject } from '@vue/shared'
import { track } from './effect'



const mutableHandlers: ProxyHandler<Record<any, any>> = {
  get(target, key, recevier) { // 代理对象的本身
    // 如果target已经被代理过了就直接返回true
    if (key === ReactiveFlags.IS_REACTIVE) {
      return true
    }
    // 触发getter收集副作用函数effect
    track(target, key)



    return Reflect.get(target, key, recevier)

  },
  set(target, key, value, recevier) {
    return Reflect.set(target, key, value, recevier)
  }
}

const reactiveMap = new WeakMap<Target, any>(); // 缓存代理过的target

// 工厂函数
export function createReactiveObject(target: Target) {

  // 判断传入的数据是否为对象
  if (!isObject(target)) {
    // __DEV__用于判断当前的代码编写环境为开发环境的时候，发出警告，因此在生产环境下这段代码为dead code，利用tree-shaking(依赖于ES Module)移除掉
    if ('__DEV__') {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }

  // 判断target是否被代理过，如果target是一个响应式对象，这里会触发getter(主要针对于target是一个响应式对象，如果target是原始对象不会触发getter，只有响应式对象才会触发getter)
  if (target[ReactiveFlags.IS_REACTIVE]) {
    return target
  }

  // 优先通过原始对象 obj 寻找之前创建的代理对象，如果找到了，直接返回已有的代理对象，简单的说就是代理过的对象不再重复代理，取出之前创建的代理对象返回
  const existionProxy = reactiveMap.get(target)
  if (existionProxy)
    return existionProxy

  const proxy = new Proxy(target, mutableHandlers) // 数据劫持

  reactiveMap.set(target, proxy) // 缓存


  return proxy // 返回代理
}



export function reactive(target: object) {
  return createReactiveObject(target)
}

export function readonly(target: object) {

}


export function shallowReactive(target: object) {

}

export function shallowReadOnly(target: object) {

}


export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
}


export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive', // 一个对象已经被代理过的标志
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw'
}
