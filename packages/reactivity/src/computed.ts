import { isFunction, NOOP } from "@vue/shared"
import { Dep } from './dep'
import { Ref, trackRefValue, triggerRefValue } from './ref'
import { ReactiveEffect } from './effect'
import { ReactiveFlags, toRaw } from "./reactive"

/**
 * state.age 收集computed的副作用函数
 * 
 * Myage.value 相当于计算属性收集最外层 effect
 * 
 */
// const Myage = computed(() => {
//   return state.age + 19;
// });
// effect(() => {
//   console.log(Myage.value); // 这样做的话相当于是个嵌套的effect,state.age收集了传给computed的副作用函数
// });
// // 需要通过.value 才执行
// setTimeout(() => {
//   state.age = 20;
// }, 2000);

declare const ComputedRefSymbol: unique symbol

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
  [ComputedRefSymbol]: true
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (...args: any[]) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined // 收集依赖

  private _value!: T
  public readonly effect: ReactiveEffect<T> // 计算属性依赖于effect

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean = false

  public _dirty = true  // 默认脏的
  public _cacheable: boolean // 

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
  ) {
    // 这里将计算属性包成一个 effect , getter 相当于 effect 当中的副作用函数 fn
    this.effect = new ReactiveEffect(getter, () => {
      // 稍后计算属性的值发生变化了,不要重新执行 getter,而是走第二个函数 scheduler
      if (!this._dirty) {
        this._dirty = true

        // 重新执行最外层的effect
        triggerRefValue(this)
        // triggerEffects(this.dep)
      }
    })

    this.effect.computed = this
    this.effect.active = this._cacheable = !false
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  // 取值时, 编译完就是 Object.defineProperty
  get value() {
    // if (isTracking()) { //是否是在 effect 中取值的
    //   trackEffects(this.dep || (this.dep = new Set<ReactiveEffect>)) // 
    // }

    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    // 如果直接是 computed 自己本身，这里返回的 self == this，这个和 toRaw 的判断依据有关
    const self = toRaw(this)
    // 将外层的effect收集,相当于收集 computed.value -> Set(effect)
    trackRefValue(self)
    if (self._dirty || !self._cacheable) {
      // 缓存结果 
      self._dirty = false
      self._value = self.effect.run()!
    }
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue) // 如果修改计算属性的值就走setter
  }
}

// 函数重载，computed 可以接受函数或者对象
export function computed<T>(
  getter: ComputedGetter<T>,
): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>,
): WritableComputedRef<T>
export function computed<T>(getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>) {
  // 判断传入的值是函数还是配置对象{get,set}
  const onlyGetter = isFunction(getterOrOptions)

  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (onlyGetter) {
    getter = getterOrOptions
    setter = NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter)

  return cRef as any
}





