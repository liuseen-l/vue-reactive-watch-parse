import { toRaw, ReactiveFlags, toReactive, toReadonly } from './reactive'
import { track, trigger, ITERATE_KEY, MAP_KEY_ITERATE_KEY } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { hasOwn, hasChanged, toRawType, isMap } from '@vue/shared'

export type CollectionTypes = IterableCollections | WeakCollections

type IterableCollections = Map<any, any> | Set<any>
type WeakCollections = WeakMap<any, any> | WeakSet<any>
type MapTypes = Map<any, any> | WeakMap<any, any>
type SetTypes = Set<any> | WeakSet<any>

const toShallow = <T extends unknown>(value: T): T => value

const getProto = <T extends CollectionTypes>(v: T): any => Reflect.getPrototypeOf(v)

function get(
  target: MapTypes,
  key: unknown,
  isReadonly = false,
  isShallow = false
) {
  // 先获取代理对象的原始map
  target = (target as any)[ReactiveFlags.RAW]

  // 确保是真正的原始对象map   readonly(reactive(Map))  
  const rawTarget = toRaw(target)

  // 获取 key 的原始对象
  const rawKey = toRaw(key)

  // 如果是非只读，需要收集依赖
  if (!isReadonly) {
    // 在这里对 key 进行了判断，有可能这个 key 是经过代理的 reactive(new Map([ [ reactive(obj) , 'bar' ] ])) ，在这里对2个key依赖都进行了收集
    // 注意我们实际上并没有判断这个 key 是否存在于map当中，无论存在与否，都应该去收集依赖，保证后面set这个值的时候能够触发依赖
    /**
     * 比如:
     *    1. const map = reactive(Map)
     *    2. effect(()=>{ map.get('xxx') }) // nothing
     *    3. map.set('xxx',value) // expect the step2 can be triggerd，so the key of 'xxx' should be tracked at step2
     */
    if (key !== rawKey) {
      track(rawTarget, key, TrackOpTypes.GET)
    }
    track(rawTarget, rawKey, TrackOpTypes.GET)
  }

  // 获取 map 对象身上的 has 方法
  const { has } = getProto(rawTarget)

  const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive

  // 首先判断原始对象身上是否有 get 的这个 key
  if (has.call(rawTarget, key)) {
    // 根据 isShallow isReadonly 拿到具体的转换方法，如果是返回的数据类型是对象类型，需要进行转换包装 
    // 这里没有使用 rawTarget.get(key) 而是使用 target，readonly(reactive(Map)) ,此时的 target 是 reactive(Map),不会收集到重复的依赖，因为上方track实际上是用 rawTarget 去收集的
     return wrap(target.get(key))
  } 
  // 如果原始对象身上没有 key，需要考虑 key 的原始对象
  else if (has.call(rawTarget, rawKey)) {
    return wrap(target.get(rawKey))
  }
  //  readonly(reactive(Map)) ???
  else if (target !== rawTarget) {
    target.get(key)
  }
}

function has(this: CollectionTypes, key: unknown, isReadonly = false): boolean {
  const target = (this as any)[ReactiveFlags.RAW]
  const rawTarget = toRaw(target)
  const rawKey = toRaw(key)
  if (!isReadonly) {
    if (key !== rawKey) {
      track(rawTarget, key, TrackOpTypes.HAS,)
    }
    track(rawTarget, rawKey, TrackOpTypes.HAS,)
  }
  return key === rawKey
    ? target.has(key)
    : target.has(key) || target.has(rawKey)
}

function size(target: IterableCollections, isReadonly = false) {
  // 拿到代理对象的原始集合
  target = (target as any)[ReactiveFlags.RAW]

  !isReadonly && track(toRaw(target), ITERATE_KEY, TrackOpTypes.ITERATE)
  //  在这里我们将Reflect的第三个值更改为了target，即代理对象的原始集合，因为访问 Set 的 size 属性时，内部会将 S 赋值为this(当前size属性的调用者),然后调用S.[[SetData]]，
  //  如果第三个参数不传入原始集合的话，那么当前 proxy 身上是没有 [[SetData]] 这个内部方法的，因此会报错
  return Reflect.get(target, 'size', target)
}


// 新增元素
function add(this: SetTypes, value: unknown) {
  // 如果新增的元素是响应式对象，我们给他先处理一下，拿到他的原始对象，将原始对象添加进去
  value = toRaw(value)
  // 还是拿到原始对象
  const target = toRaw(this)
  // 获取原始对象的 has 方法
  const { has } = getProto(target)
  // 判断当前的原始集合中是否含有这个元素，防止重复添加，虽然set有去重功能，但还是有性能的消耗
  const hadKey = has.call(target, value)
  // 如果没有
  if (!hadKey) {
    // 向原始集合中新增元素
    target.add(value)
    // 触发新增元素的trigger，可以将size绑定的副作用函数重新执行
    trigger(target, value, TriggerOpTypes.ADD, value)
  }
  return this
}

/**
 * 为什么set方法设置值的时候需要进行value的toRaw转换，很重要的一个原因就是污染原始数据
 * 
 * // 原始 Map 对象 m
 * const m = new Map()
 * // p1 是 m 的代理对象
 * const p1 = reactive(m)
 * // p2 是另外一个代理对象
 * const p2 = reactive(new Map())
 * // 为 p1 设置一个键值对，值是代理对象 p2
 * p1.set('p2', p2)
 *
 * effect(() => {
 * // 注意，这里我们通过原始数据 m 访问 p2
 * console.log(m.get('p2').size)
 * })
 * // 注意，这里我们通过原始数据 m 为 p2 设置一个键值对 foo --> 1
 *  m.get('p2').set('foo', 1)
 * 
 * 我们通过原始数据 m 来读取数据值，然后又通过原始数据 m 设置数据值，此时发现副作用函数重新执行了。这其实不是我们所期望的行为，因为原始数据不应该具有响应式数据的能力，
 *  我们把响应式数据设置到原始数据上的行为称为数据污染。
 * 
 * 其实除了 set 方法需要避免污染原始数据之外，Set 类型的 add 方法、普通对象的写值操作，还有为数组添加元素的方法等，都需要做类似的处理。
 */


function set(this: MapTypes, key: unknown, value: unknown) {
  // 获取新增元素的原始数据
  value = toRaw(value)
  // 确保代理的对象的原始 map 是真正的原始map
  const target = toRaw(this)

  // 获取原始map 的 has 和 get 方法
  const { has, get } = getProto(target)

  // 判断当前原始map有没有这个key
  let hadKey = has.call(target, key)

  // Map -> reactive(key):value
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(target, key)
  } 

  // 拿到原始值
  const oldValue = get.call(target, key)

  // 设置值
  target.set(key, value)

  // 根据原来有没有这个key 判断当前的set 操作是新增数据还是修改数据
  if (!hadKey) {
    trigger(target, key, TriggerOpTypes.ADD, value)
  } else if (hasChanged(value, oldValue)) { // 在触发修改操作之前，判断一下新设置的值是否和原来的值是一样的 
    trigger(target, key, TriggerOpTypes.SET, value)
  }

  return this
}

function deleteEntry(this: CollectionTypes, key: unknown) {

  // 还是先获取代理对象的原始集合
  const target = toRaw(this)
  // 获取原始集合的 get 和 set 方法
  const { has, get } = getProto(target)
  // 判断集合是否有当前这个值
  let hadKey = has.call(target, key)
  // 如果是 map.delete(map.get(obj))
  // if (!hadKey) {
  //   key = toRaw(key)
  //   hadKey = has.call(target, key)
  // }

  // 先判断是否能拿到 get 方法，因为set原始对象是没有 get 这个方法的，有 get 方法说明是 target 是 map，调用他的 get 方法获取值
  const oldValue = get ? get.call(target, key) : undefined

  // 通过原始集合删除这个值（因为只有原始集合内部方法才有[[SetData]]） 
  const result = target.delete(key)

  // 如果有这个值再删除
  if (hadKey) {
    // 需要将 size 收集的依赖拿出来执行
    trigger(target, key, TriggerOpTypes.DELETE, undefined)
  }
  return result
}



function createForEach(isReadonly: boolean, isShallow: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    const observed = this as any
    const target = observed[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    !isReadonly && track(rawTarget, ITERATE_KEY, TrackOpTypes.ITERATE)
    return target.forEach((value: unknown, key: unknown) => {
      // important: make sure the callback is
      // 1. invoked with the reactive map as `this` and 3rd arg
      // 2. the value received should be a corresponding reactive/readonly.
      return callback.call(thisArg, wrap(value), wrap(key), observed)
    })
  }
}

interface Iterable {
  [Symbol.iterator](): Iterator
}

interface Iterator {
  next(value?: any): IterationResult
}

interface IterationResult {
  value: any
  done: boolean
}

function createIterableMethod(
  method: string | symbol,
  isReadonly: boolean,
  isShallow: boolean
) {

  return function (this: IterableCollections, ...args: unknown[]): Iterable & Iterator {
    const target = (this as any)[ReactiveFlags.RAW]
    const rawTarget = toRaw(target)
    const targetIsMap = isMap(rawTarget)
    const isPair =
      method === 'entries' || (method === Symbol.iterator && targetIsMap)
    const isKeyOnly = method === 'keys' && targetIsMap
    const innerIterator = target[method](...args)
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    !isReadonly &&
      track(
        rawTarget,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY,
        TrackOpTypes.ITERATE
      )
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
            value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
            done
          }
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this
      }
    }
  }
}


function createInstrumentations() {
  const mutableInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) { // Map
      // 此时的this是map的代理对象
      return get(this, key)
    },
    get size() { // Set Map
      /**
       *  当代理对象访问size属性的时候，会执行到这里，由于size是一个访问器属性
       *  因此get size()中的代码都会执行，在size作用域里面 this 是 set 代理的对象，但是我们最后返回的结果是调用size()函数的结果
       * 
       *  */
      return size(this as unknown as IterableCollections)
    },
    has, // Set Get
    add, // Set
    set, // Map
    delete: deleteEntry, // Set Map
    forEach: createForEach(false, false)
  }

  const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]

  iteratorMethods.forEach(method => {
    // 为 mutableInstrumentations 新增keys values entries 方法
    mutableInstrumentations[method as string] = createIterableMethod(
      method,
      false,
      false
    )
  })
  return [
    mutableInstrumentations,
  ]
}

const [
  mutableInstrumentations,
] = createInstrumentations()


function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = mutableInstrumentations

  // 这个函数是 proxy 当中的 get 函数，
  return (target: CollectionTypes, key: string | symbol, receiver: CollectionTypes) => {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.RAW) {
      return target
    }

    return Reflect.get(hasOwn(instrumentations, key) && key in target ? instrumentations : target, key, receiver)
  }
}

export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, false)
}

function checkIdentityKeys(
  target: CollectionTypes,
  has: (key: unknown) => boolean,
  key: unknown
) {
  const rawKey = toRaw(key)
  if (rawKey !== key && has.call(target, rawKey)) {
    const type = toRawType(target)
    console.warn(
      `Reactive ${type} contains both the raw and reactive ` +
      `versions of the same object${type === `Map` ? ` as keys` : ``}, ` +
      `which can lead to inconsistencies. ` +
      `Avoid differentiating between the raw and reactive versions ` +
      `of an object and only use the reactive version if possible.`
    )
  }
}


