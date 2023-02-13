import { createDep, Dep } from './dep'
import { hasChanged, IfAny, isArray  } from '@vue/shared'
import { isProxy, isReadonly, isShallow, toRaw, toReactive } from './reactive'
import { activeEffect, shouldTrack, trackEffects, triggerEffects } from './effect'

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

/**
 * ref 和 shallowRef 实际上都是对value收集了依赖，那么为什么 ref({a:1}) ref.value.a = 2 能触发响应式呢
 * 原因在于 ref 对引用数据类型就行了 toReactive 转换 ref.value 返回的实际是 reactive({a:1}) 然后访问响应式的a属性，它自身和副作用函数建立了依赖关系
 * 因此 ref.value.a = 2 是 reactive({a:1}) 触发的响应式，但是 shallowRef 没有转换，返回的就是 {a:1}，不具备响应式
 * 
 *  */ class RefImpl<T> {
  private _value: T
  private _rawValue: T // 如果是 ref 存储 value 的原始对象，如果是 shallowRef 直接存储 value

  public dep?: Dep = undefined

  // 判断当前的实例是否为Ref对象
  public readonly __v_isRef = true

  // 这里ref 的 __v_isShallow 为false，用于判断是不是浅层次的响应式,即判断调用的函数时shallowRef 还是 ref
  constructor(value: T, public readonly __v_isShallow: boolean) {

    // 这里传入的值可能是一个reactive代理的响应式对象，因此通过toRaw方法，返回reactive代理的原始对象，如果是浅层次响应式直接赋值
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
    return this._value
  }

  // 在这里，无论是ref还是shallowRef的实例对象，都是同样的方式进行存储
  set value(newVal) {
    /**
     * 判断是否将传入的 newValue值 直接设置为当前 ref 的 value 值，为以下三种类型的话就直接设置为当前实例的 value 值
     *  1.当前为 shallowRef 实例
     *  2.当前为 ref 实例，但是传入的值是 shallow 类型
     *  3.当前为 ref 实例，但是传入的值是 readonly 类型
     *  
     * 首先我们需要明确直接赋值的判断用于什么地方影响最大？ 用于这里判断的意义在于什么？
     * 观察下面的代码我们看到 useDirectValue 的最终判断结果用在了 useDirectValue ? newVal : toReactive(newVal)
     * 这行代码很直观的反映了 useDirectValue 决定了最后的 newValue 是否需要进行 toReactive 转换
     * 
     * 那么我们再回过头来看决定 useDirectValue 结果的三个判断  this.__v_isShallow || isShallow(newVal) || isReadonly(newVal)
     * 
     * 对于情况一是很好理解的，因为当前为 shallowRef 实例的话只需要劫持最外层的响应式，因此传入的数据如果是对象的话，最好设置 value 的时候不需要进行 toReactive 的转换
     * 
     * 对于情况二来说，ref 是深层次的响应，但是传入的值是浅层次的响应对象的时候比如 shallowReactive，我们可以直接将起赋值给 ref 的 value 值，因为本身就是响应式的我们不需要再去转换响应式
     *
     * 对于情况三来说, ref 是深层次的相应，但是传入的值是只读的相应对象的时候比如 readonly，我们也可以直接将起赋值给 ref 的 value 值，因为本身就是响应式的我们不需要再去转换响应式                                      
     * 
     *  */
    const useDirectValue = this.__v_isShallow || isShallow(newVal) || isReadonly(newVal)

    /**
     * let obj = { a : 1}
     * let r = ref(reactive(obj))
     * 
     * r.value = shallowReactive(obj)
     * 
     */
    newVal = useDirectValue ? newVal : toRaw(newVal)

    // 判断传入的数据是否发生了变化，如果是reactive类型的话，这里是经过 toRaw 转换的，ref 实例如果保存的结果为 reactive 类型的话，那么它的 _rawValue 始终是指向
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal
      this._value = useDirectValue ? newVal : toReactive(newVal)
      triggerRefValue(this, newVal)
    }
  }
}

// shallowRef 板块
// 传入对象
export function shallowRef<T extends object>(value: T): T extends Ref ? T : ShallowRef<T>
// 传入基本数据类型
export function shallowRef<T>(value: T): ShallowRef<T>
// 传入自定义的一些类型，比如class
export function shallowRef<T = any>(): ShallowRef<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

// ref依赖收集板块
export function trackRefValue(ref: RefBase<any>) {
  if (shouldTrack && activeEffect) {
    // 如果这里传入的是ref实例的话，那么返回的结果始终是ref实例本身，因为内部是通过__v_raw属性来判断的，ref实例身上没有这个属性
    ref = toRaw(ref)
    // 在这里判断了一下是否为开发环境，开发环境传入第二个参数
    trackEffects(ref.dep || (ref.dep = createDep()))
  }
}

export function triggerRefValue(ref: RefBase<any>, newVal?: any) {
  ref = toRaw(ref)

  // 首先判断当前的ref实例上是否有收集过依赖
  if (ref.dep) {
    // 判断当前的运行环境，如果是开发环境的话，传入第二个参数用于debugger
    triggerEffects(ref.dep)
  }
}

// 自定义计算属性

class CustomRefImpl<T> {
  public dep?: Dep = undefined

  private readonly _get: ReturnType<CustomRefFactory<T>>['get']
  private readonly _set: ReturnType<CustomRefFactory<T>>['set']

  public readonly __v_isRef = true

  constructor(factory: CustomRefFactory<T>) {
    const { get, set } = factory(
      () => trackRefValue(this),
      () => triggerRefValue(this)
    )
    this._get = get
    this._set = set
  }

  get value() {
    return this._get()
  }

  set value(newVal) {
    this._set(newVal)
  }
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as any
}


// toRef

class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly __v_isRef = true
  /**
  * 假设
  *   _object = reactive({ a : 1})
  *   _key = a 
  */
  constructor(
    private readonly _object: T,
    private readonly _key: K,
    private readonly _defaultValue?: T[K]
  ) { }

  get value() {
    //  value = reactive({a:1}).a 触发track
    const val = this._object[this._key]
    return val === undefined ? (this._defaultValue as T[K]) : val
  }

  set value(newVal) {
    // reactive({a:1}).a = newVal，触发 trigger
    this._object[this._key] = newVal
  }
}

export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>


export function toRef<T extends object, K extends keyof T>(object: T, key: K): ToRef<T[K]>
export function toRef<T extends object, K extends keyof T>(object: T, key: K, defaultValue: T[K]): ToRef<Exclude<T[K], undefined>>
export function toRef<T extends object, K extends keyof T>(object: T, key: K, defaultValue?: T[K]): ToRef<T[K]> {
  const val = object[key]
  // 判断 val 是否为 ref 实例，如果是 ref 实例直接返回 val
  return isRef(val) ? val : (new ObjectRefImpl(object, key, defaultValue) as any)
}


//  toRefs
export type ToRefs<T = any> = {
  [K in keyof T]: ToRef<T[K]>
}

export function toRefs<T extends object>(object: T): ToRefs<T> {
  // 判断传入的值是否为响应式对象
  if (!isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  // 判断传入的值是否为数组，如果是数组，创建一个原始数组，反之返回{}
  const ret: any = isArray(object) ? new Array(object.length) : {}
  // 遍历传入值的 key，如果是数组的话，key 就是下标，如果是对象的话就是 key
  /**
   *  如果是响应式对象
   *    const key = isArray(target) ? 'length' : ITERATE_KEY
   *    track(target, key, TrackOpTypes.ITERATE) 会收集依赖，如果 object 发生变化会重新执行 toRefs，因为 toRefs 实际上也在 effect 当中的
   *  */ 
  for (const key in object) {
    ret[key] = toRef(object, key)
  }
  return ret
}