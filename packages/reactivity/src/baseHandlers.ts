import { reactive, ReactiveFlags, readonly, Target, toRaw } from './reactive'
import { ITERATE_KEY, track, trigger } from './effect'
import { extend, hasChanged, hasOwn, isArray, isIntegerKey, isObject } from '@vue/shared'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { warn } from './warning'

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) { // 代理对象的本身
    // 如果target已经被代理过了就直接返回true
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if (key === ReactiveFlags.RAW) {
      // 用于获取 receiver 的原始对象
      return target
    }

    const res = Reflect.get(target, key, receiver)

    // 如果不是只读，触发getter收集副作用函数effect
    if (!isReadonly) {
      track(target, key)
    }

    // 如果是浅层次的读
    if (shallow) {
      return res
    }

    // 如果返回的对象是对象，判断是否为 readonly ,如果是 readonly 那么递归调用readonly，保证深层次的对象也是只读的，reactive 同理，递归包裹深层次对象成为响应式，可以深层次的实现响应式
    if (isObject(res)) {
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

function createSetter(shallow = false) {
  return function set(target: object, key: string | symbol, value: unknown, receiver: object) { // receiver是代理对象的本身
    // 拿到旧值,便于触发更新前的比较
    let oldValue = (target as any)[key]
    /**
     *  # hadKey 这一步用来判断当前访问的key,是否是target自身的属性，如果是的话表示当前的set操作是修改数据，反之则是增添属性的操作
     * 
     *  # hadKey 这一步其实有2个作用
     *    1.针对数组，判断原始数组是否有这个key
     *        如果当前的原始对象是数组类型，并且key是数字类型，或者字符串的数字类型( 0 or '0')，执行 Number(key) < target.length 判单数组有没有这个key
     *    2.针对对象，判断原始对象是否有这个key
     *        如果当前的原始对象是对象类型，执行 hasOwn(target, key) ，判断自身是否含有key（不包括原型链上的属性）
     */
    const hadKey = isArray(target) && isIntegerKey(key) ? Number(key) < target.length : hasOwn(target, key)

    // 需要先设置值，再去追踪，重新执行副作用函数，否者执行副作用函数的时候值没有发生变化
    const res = Reflect.set(target, key, value, receiver)

    // 这里判断当前代理对象的原始对象是否为target,防止原型链响应式对象触发 setter 导致重复触发 trigger
    if (target === toRaw(receiver)) {
      // 如果没有访问的key，无论是对于数组还是对象，都是新增属性
      if (!hadKey) {
        trigger(target, key, TriggerOpTypes.ADD)
      } else if (hasChanged(value, oldValue)) { // 如果我们修改的属性值和原来的值一样，没必要去更新，影响性能
        trigger(target, key, TriggerOpTypes.SET)
      }
    }
    return res
  }
}

// 'foo' in p 
function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, key)
  return result
}

// for key in p 
function ownKeys(target: object): (string | symbol)[] {
  // 判断当前遍历的对象是object类型还是数组类型
  const key = isArray(target) ? 'length' : ITERATE_KEY
  track(target, key, TrackOpTypes.ITERATE)
  return Reflect.ownKeys(target)
}

// 删除属性的时候触发
function deleteProperty(target: object, key: string | symbol): boolean {
  // 判断要删除的属性是否存在当前的target身上
  const hadKey = hasOwn(target, key)

  const result = Reflect.deleteProperty(target, key)
  // 当前 target 存在要删除的属性,并且成功删除了
  if (result && hadKey) {
    trigger(target, key, TriggerOpTypes.DELETE)
  }
  return result
}

// 深层次响应式模块的Handlers
const get = createGetter()
const set = createSetter()

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  has,
  ownKeys,
  deleteProperty
}

// 浅层次响应式模块的Handlers
const shallowGet = createGetter(false, true)
const shallowSet = createSetter(true)

export const shallowReactiveHandlers = extend(
  {},
  mutableHandlers,
  // 用 shallowReactiveHandlers 覆盖 mutableHandlers 当中的 get 和 set ，其余继承
  {
    get: shallowGet,
    set: shallowSet
  }
)

// 只读模块的Handlers
const readonlyGet = createGetter(true)

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet, // 虽然是只读的，但是也是用reactive层层包裹了的，但是没有track去收集依赖
  set(target, key) {
    warn(
      `Set operation on key "${String(key)}" failed: target is readonly.`,
      target
    )
    return true
  },
  deleteProperty(target, key) {
    warn(
      `Delete operation on key "${String(key)}" failed: target is readonly.`,
      target
    )
    return true
  }
}


