import { ReactiveFlags, Target } from './reactive'
import { track, trigger } from './effect'


function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) { // 代理对象的本身
    // 如果target已经被代理过了就直接返回true
    if (key === ReactiveFlags.IS_REACTIVE) {
      return true
    } else if (key === ReactiveFlags.RAW) {
      return target
    }
    // 触发getter收集副作用函数effect
    track(target, key)
    return Reflect.get(target, key, receiver)
  }
}

function createSetter(shallow = false) {
  return function set(target: object, key: string | symbol, value: unknown, receiver: object) { // 代理对象的本身
    // 需要先设置值，再去追踪，重新执行副作用函数
    const res = Reflect.set(target, key, value, receiver)
    trigger(target, key)
    return res
  }
}

const get = createGetter()
const set = createSetter()

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set
}



