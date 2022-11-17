import { isObject, toRawType } from '@vue/shared'
import { mutableHandlers, readonlyHandlers, shallowReactiveHandlers, shallowReadonlyHandlers } from './baseHandlers'
import { mutableCollectionHandlers, } from './collectionHandlers';

/**
 * 
 * 这个不仅仅是为了优化，一些场景有奇效，比如 reactive([{}]).includes(arr[0]) 
 * 由于includes内部会访问arr[0],然后和传入的arr[0]比较的时候，如果不用这个缓存，
 * 那么将是两个不同的代理对象,虽然这一步可以优化，但是由于 reactive([obj]) arr.includes(obj) 
 * 会返回false的原因，不得不重写了includes，因此这里的优化在includes重新实现了
 * 
 *  */
export const reactiveMap = new WeakMap<Target, any>(); // 缓存代理过的target
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

const enum TargetType {
  INVALID = 0, // 无效的
  COMMON = 1, // 正常的对象或者数组
  COLLECTION = 2 // 集合
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

// 获取代理目标的类型
function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value) ? TargetType.INVALID : targetTypeMap(toRawType(value))
}

// 工厂函数
export function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>) {

  // 判断传入的数据是否为对象
  if (!isObject(target)) {
    // __DEV__用于判断当前的代码编写环境为开发环境的时候，发出警告，因此在生产环境下这段代码为dead code，利用tree-shaking(依赖于ES Module)移除掉
    if ('__DEV__') {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }

  // 判断target是否被代理过，如果target是一个响应式对象，这里会触发getter(主要针对于target是一个响应式对象，如果target是原始对象不会触发getter，只有响应式对象才会触发getter)
  // && 后面的 判断用于 readonly(reactive(obj)) 这样的情况
  if (target[ReactiveFlags.RAW] && !(isReadonly && target[ReactiveFlags.IS_REACTIVE])) {
    // console.log(isReadonly);
    // console.log(target[ReactiveFlags.IS_REACTIVE]);
    return target
  }

  // 优先通过原始对象 obj 寻找之前创建的代理对象，如果找到了，直接返回已有的代理对象，简单的说就是代理过的对象不再重复代理，取出之前创建的代理对象返回
  const existionProxy = proxyMap.get(target)
  if (existionProxy) {
    return existionProxy
  }

  // 在这里需要对传入的target进行一个判断，因为set，map的处理方式和普通的对象或者数组不一样
  const targetType = getTargetType(target)
  // 如果是个无效的target，直接返回
  if (targetType === TargetType.INVALID) {
    return target
  }

  const proxy = new Proxy(
    target,
    // 根据不同的target类型，选择不同的handlers，因为集合的处理方式和普通对象或者数组不一样
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  ) // 数据劫持

  proxyMap.set(target, proxy) // 缓存
  return proxy // 返回代理
}

export declare const ShallowReactiveMarker: unique symbol
export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }
export function shallowReactive<T extends object>(target: T): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    mutableCollectionHandlers,
    shallowReactiveMap
  )
}

export function reactive(target: object) {
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

export function readonly<T extends object>(target: T) {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    mutableCollectionHandlers,
    readonlyMap
  )
}

export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    mutableCollectionHandlers,
    shallowReadonlyMap
  )
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

export function toRaw<T>(observed: T): T {
  // 如果传入的对象是一个响应式对象,例如reactive代理的响应式对象,可以访问该代理对象的'__v_raw'属性,这个属性会返回代理对象的原始对象
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  // 如果这里获取到了原始对象,但是这个原始对象还可能是一个响应式对象,因此需要递归的去调用toRaw方法去获取原始对象,直到真正的获取到了原始对象
  return raw ? toRaw(raw) : observed
}

export const toReactive = <T extends unknown>(value: T): T =>
  // 判断传入的原始数据是否为对象类型
  // 如果传入的原始数据是对象类型,那么调用reactive去进行代理,这里reactive内部其实也是进行了相关的优化,如果一个原始值已经是被代理过的,那么会直接返回已经代理的对象,就不用重新去代理了
  // 如果传入的原始数据不是对象类型,那么直接返回该数据
  isObject(value) ? reactive(value as object) : value


  export const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value as Record<any, any>) : value
