import { isFunction, NOOP } from "@vue/shared"
import { Dep } from './dep'
import { isTracking, ReactiveEffect, trackEffects, triggerEffects } from './effect'
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

export type ComputedGetter<T> = (...args: any[]) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined
  private _value!: T
  public readonly effect: ReactiveEffect<T> // 计算属性依赖于effect
  public readonly __v_isRef = true
  public _dirty = true  // 默认脏的
  public readonly [ReactiveFlags.IS_READONLY]: boolean = false

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly?: boolean,
  ) {
    // 这里将计算属性包成一个effect , getter相当于effect当中的副作用函数
    this.effect = new ReactiveEffect(getter, () => {
      // 稍后计算属性的值发生变化了,不要重新执行getter,而是走第二个函数
      if (!this._dirty) {
        this._dirty = true
        // 重新执行最外层的effect
        triggerEffects(this.dep)
      }
    })
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  // 取值时, 编译完就是Object.defineProperty
  get value() {
    if (isTracking()) { //是否是在effect中取值的
      trackEffects(this.dep || (this.dep = new Set<ReactiveEffect>)) // 将外层的effect收集,相当于收集 computed.value -> Set(effect)
    }

    if (this._dirty) {
      // 缓存结果 
      this._dirty = false
      this._value = this.effect.run()
    }
    return this._value
  }

  set value(newValue: T) {
    this._setter(newValue) // 如果修改计算属性的值就走setter
  }
}

export function computed<T>(getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>) {
  // 判断传入的值是函数还是配置对象{get,set}
  const onlyGetter = isFunction(getterOrOptions)

  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (onlyGetter) {
    getter = getterOrOptions
    setter = false // __DEV__
      ? () => {
        console.warn('Write operation failed: computed value is readonly')
      }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  return new ComputedRefImpl(getter, setter)
}





