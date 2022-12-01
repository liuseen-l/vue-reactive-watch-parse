import { createDep, Dep } from './dep'
import { hasChanged, isObject } from '@vue/shared'
import { isReadonly, isShallow, reactive, toRaw, toReactive } from './reactive'
import { activeEffect, isTracking, shouldTrack, trackEffects, triggerEffects } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'

// ref入口函数
export function ref(value?: unknown) {
  // 内部调用 createRef 函数，尾调用优化
  return createRef(value, false)
}

// 真正创建 ref 实例的构造函数
function createRef(rawValue: unknown, shallow: boolean) {
  // 判断传入的值是否为ref的实例，如果是直接返回
  if (isRef(rawValue)) {
    return rawValue
  }

  // 如果不是，调用RefImpl构造函数，即创建ref实例 ， value,false
  return new RefImpl(rawValue, shallow)
}

// ref
class RefImpl<T> {
  private _value: T
  private _rawValue: T

  public dep?: Dep = undefined

  // 判断当前的实例是否为Ref对象
  public readonly __v_isRef = true

  // 这里ref 的 __v_isShallow 为false，用于判断是不是浅层次的响应式,即判断调用的函数时shallowRef 还是 ref
  constructor(value: T, public readonly __v_isShallow: boolean) {

    // 这里传入的值可能是一个reactive代理的响应式对象，因此通过toRaw方法，返回reactive代理的原始对象
    this._rawValue = __v_isShallow ? value : toRaw(value) // 访问value['__v_raw]获取到原始对象并进行保存

    // 对原始数据进行代理，首先判断是不是浅层次的响应式，如果不是就进行响应式的转换，这里转换的时候toReactive内部进行了对象判断，如果不是对象类型，直接返回的就是value
    this._value = __v_isShallow ? value : toReactive(value)

    /**
     *  执行到这里的时候,ref的实例已经是创建完成
     *    让我们回顾整个创建的过程
     *      1.首先我们是获取了传入的数据的原始数据
     *      2.判断原始数据的数据类型是否为对象类型,如果是对象调用 reactive 进行代理,反之返回原始数据
     *      3.将最终处理的数据保存在 _value 当中,基本数据类型就是基本数据类型,引用类型就通过 reactive 代理
     */
  }

  /**
   * 通过ref实例.value 获取到 _value 的值，_value值的类型根据 toReactive()的返回结果决定，
   * 如果不是对象就是原始值。如果是对象，返回的是通过 reactive() 包装后的对象，也就是通过 Proxy() 代理的
   */
  get value() {
    // 取值的时候依赖收集，首先调用trackRefValue，并将当前ref实例传过去

    trackRefValue(this)

    // if (isTracking()) {
    //   trackEffects(this.dep || (this.dep = new Set()))
    // }
    return this._value
  }

  // 在这里，无论是ref还是shallowRef的实例对象，都是同样的方式进行存储
  set value(newVal) {

    const useDirectValue =
      this.__v_isShallow || isShallow(newVal) || isReadonly(newVal)
    newVal = useDirectValue ? newVal : toRaw(newVal)
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = useDirectValue ? newVal : toReactive(newVal)
      triggerRefValue(this, newVal)
    }

    // 设置值的时候触发更新
    if (newVal !== this._rawValue) {
      this._rawValue = newVal
      this._value = toReactive(newVal)
      trackEffects(this.dep)
    }
  }
}

export function shallowRef<T extends object>(value: T): T extends Ref ? T : ShallowRef<T>
export function shallowRef<T>(value: T): ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

declare const RefSymbol: unique symbol
export interface Ref<T = any> {
  value: T
  [RefSymbol]: true
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>

// 如果传入ref的对象，已经是 ref 的实例
export function isRef(r: any): r is Ref {
  return !!(r && r.__v_isRef === true)
}

declare const ShallowRefMarker: unique symbol
export type ShallowRef<T = any> = Ref<T> & { [ShallowRefMarker]?: true }


type RefBase<T> = {
  dep?: Dep
  value: T
}

export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    // 如果这里传入的是ref实例的话，那么返回的结果始终是ref实例本身，因为内部是通过__v_raw属性来判断的，ref实例身上没有这个属性
    ref = toRaw(ref)
    // 在这里判断了一下是否为开发环境，开发环境传入第二个参数
    if (__DEV__) {
      // 收集依赖
      trackEffects(ref.dep || (ref.dep = createDep()), {
        target: ref,
        type: TrackOpTypes.GET,
        key: 'value'
      })
    } else {
      trackEffects(ref.dep || (ref.dep = createDep()))
    }
  }
}

export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)

  // 首先判断当前的ref实例上是否有收集过依赖
  if (ref.dep) {
    // 判断当前的运行环境，如果是开发环境的话，传入第二个参数用于debugger
    if (__DEV__) {
      triggerEffects(ref.dep, {
        target: ref,
        type: TriggerOpTypes.SET,
        key: 'value',
        newValue: newVal
      })
    } else {
      triggerEffects(ref.dep)
    }
  }
}

