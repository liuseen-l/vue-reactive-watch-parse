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

/**
   *  对于普通对象像这种嵌套情况很好处理，map set 这种集合就会麻烦一点
   *  因为例如
   *        const state = readonly(reactive(obj)) , 我们在state.xxx 的时候，会触发getter ，内部调用 
   *        const res = Reflect.get(target, key, receiver) 此时的 target 是 reactive(obj)，执行这行代码的时候，会触发 target 的getter，因为当前 isReadonly 是 true，不会 track
   *        const res = Reflect.get(target, key, receiver) 这里的 target 才是真正的 obj,由于这里的 isReadonly 是 false，然后在这里我们才进行了track 
   *  
   * 而对于 Map 来说，获取一个值其实要操作两步，首先是 get 拿到方法，然后调用 get 才能拿到值，因此不能像对象那样直接 .xxx 就可以，不能自行递归，因此需要我们手动操作
   *      # 看上去很麻烦，其实我们只要明确目的实现起来并不困难，对于readonly(reactive(new Map([ ['xxx',reavtive(obj)] ]))) 这样的嵌套响应式
   *        我们就是希望 reactive(map) 响应层的原始对象和当前effect建立依赖关系
   *        
   *       target = (target as any)[ReactiveFlags.RAW] // target拿到的是 reactive(map)
   *       const rawTarget = toRaw(target)  // 拿到 map
   *       track(rawTarget, key, TrackOpTypes.GET) // 这也是我们的目的，让原始对象和 effect 建立依赖关系
   * 
   */
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
  /**
   * 例如以下情况
   *  const original = { a: 1 };
   *   const obj = reactive(original);
   *   const map = readonly(reactive(new Map([[original, obj["a"]]])));
   *   effect(() => {
   *     console.log(map.get(obj));
   *   });
   * 
   */
  else if (has.call(rawTarget, rawKey)) {
    return wrap(target.get(rawKey))
  }
  //  readonly(reactive(Map)) ???
  else if (target !== rawTarget) {
    target.get(key)
  }
}


function has(this: CollectionTypes, key: unknown, isReadonly = false): boolean {
  // 拿到原始对象
  const target = (this as any)[ReactiveFlags.RAW]
  // 防止响应式嵌套 readonly(reactive(map))
  const rawTarget = toRaw(target)
  // 拿到 key 的原始值  
  const rawKey = toRaw(key)
  if (!isReadonly) {
    // 这里的处理方式和 get 的方式相同，不仅仅对 key 进行了依赖收集，而且对 rawKey 也进行了依赖收集
    if (key !== rawKey) {
      track(rawTarget, key, TrackOpTypes.HAS)
    }
    track(rawTarget, rawKey, TrackOpTypes.HAS)
  }

  // const map = reactive(new Map([ [reactive(obj),1] ]))。此时 target 是原始对象 ，key 是 reactive(obj)，rawkey 是 obj，走第二个，因为我们收集依赖的时候不仅仅是对 key 收集了依赖，还对 rawKey 收集了依赖
  return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey)
}

function size(target: IterableCollections, isReadonly = false) {
  // 拿到代理对象的原始集合
  target = (target as any)[ReactiveFlags.RAW]
  // readonly(reactive(Set))
  const rawTarget = toRaw(target)

  !isReadonly && track(rawTarget, ITERATE_KEY, TrackOpTypes.ITERATE)
  //  在这里我们将Reflect的第三个值更改为了target，即代理对象的原始集合，因为访问 Set 的 size 属性时，内部会将 S 赋值为this(当前size属性的调用者),然后调用S.[[SetData]]，
  //  如果第三个参数不传入原始集合的话，那么当前 proxy 身上是没有 [[SetData]] 这个内部方法的，因此会报错
  return Reflect.get(target, 'size', target)
}


// 新增元素，服务于 Set 集合
function add(this: SetTypes, value: unknown) {
  // 如果新增的元素是响应式对象，我们给他先处理一下，拿到他的原始对象，将原始对象添加进去，防止元数据污染
  value = toRaw(value)
  // 还是拿到原始对象 readonly(reactive(set))
  const rawTarget = toRaw(this)
  // 获取原始对象的 has 方法
  const { has } = getProto(rawTarget)
  // 判断当前的原始集合中是否含有这个元素，防止重复添加，虽然set有去重功能，但还是有性能的消耗
  const hadKey = has.call(rawTarget, value)
  // 如果没有
  if (!hadKey) {
    // 向原始集合中新增元素
    rawTarget.add(value)
    // 触发新增元素的trigger，可以将size绑定的副作用函数重新执行
    trigger(rawTarget, value, TriggerOpTypes.ADD, value)
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
  const rawTarget = toRaw(this)

  // 获取原始map 的 has 和 get 方法
  const { has, get } = getProto(rawTarget)

  // 判断当前原始map有没有这个key
  let hadKey = has.call(rawTarget, key)

  // Map -> reactive(key):value
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(rawTarget, key)
  }

  // 拿到原始值
  const oldValue = get.call(rawTarget, key)

  // 设置值
  rawTarget.set(key, value)

  // 根据原来有没有这个key 判断当前的set 操作是新增数据还是修改数据
  if (!hadKey) {
    trigger(rawTarget, key, TriggerOpTypes.ADD, value)
  } else if (hasChanged(value, oldValue)) { // 在触发修改操作之前，判断一下新设置的值是否和原来的值是一样的 
    trigger(rawTarget, key, TriggerOpTypes.SET, value)
  }

  return this
}


function clear(this: IterableCollections) {
  const target = toRaw(this)

  const hadItems = target.size !== 0

  // const oldTarget = true
  //   ? isMap(target)
  //     ? new Map(target)
  //     : new Set(target)
  //   : undefined

  const result = target.clear()
  if (hadItems) {
    trigger(target, undefined, TriggerOpTypes.CLEAR, undefined)
  }
  return result
}


function deleteEntry(this: CollectionTypes, key: unknown) {

  // 还是先获取代理对象的原始集合 readonly(reactive(Map | Set))
  const rawTarget = toRaw(this)
  // 获取原始集合的 get 和 set 方法
  const { has, get } = getProto(rawTarget)
  // 判断集合是否有当前这个值
  let hadKey = has.call(rawTarget, key)
  // 如果是 map.delete(map.get(obj))

  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(rawTarget, key)
  }

  // 先判断是否能拿到 get 方法，因为set原始对象是没有 get 这个方法的，有 get 方法说明是 target 是 map，调用他的 get 方法获取值
  const oldValue = get ? get.call(rawTarget, key) : undefined

  // 通过原始集合删除这个值（因为只有原始集合内部方法才有[[SetData]]） 
  const result = rawTarget.delete(key)

  // 如果有这个值再删除
  if (hadKey) {
    // 需要将 size 收集的依赖拿出来执行
    trigger(rawTarget, key, TriggerOpTypes.DELETE, undefined)
  }
  return result
}


function createForEach(isReadonly: boolean, isShallow: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function, // 传给 forEach 的函数
    thisArg?: unknown
  ) {
    // map 的代理对象
    const observed = this as any
    // 获取 map 的原始对象
    const target = observed[ReactiveFlags.RAW]
    // 防止响应式嵌套，readonly(reactive(map)))
    const rawTarget = toRaw(target)
    // 根据响应式类型拿到转换器
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive
    // 如果不是只读的，我们需要收集遍历的依赖
    !isReadonly && track(rawTarget, ITERATE_KEY, TrackOpTypes.ITERATE)

    // 调用原始对象的 forEach ， 然后再内部调用用户传入的真正的 callback 函数，我们再调用的时候为 value 和 key 都进行了 wrap 包装
    /**
     * 这样做的原因在于
    *        const key = { key: 1 }
     *       const value = new Set([1, 2, 3])
     *       const p = reactive(new Map([
     *            [key, value]
     *       ]))
     *       
     *        effect(() => {
        *         p.forEach(function (value, key) {
        *              console.log(value.size) // 3
     *            })
     *        })
     *       
     *        p.get(key).delete(1)
     * 
     *       reactive 是深层次的响应式，因此传入的value也应该是响应式的，这样在访问 value.size 的时候才能和 effect 建立依赖关系
     *       出于严谨性，我们还需要做一些补充。因为 forEach 函数除了接收 callback 作为参数之外，它还接收第二个参数，该参数可以用来指定 callback 函数执行时的 this 值。
     */
    return target.forEach((value: unknown, key: unknown) => {
      // 这里将 value 用 wrap 包裹，相当于说 get了某一个值，然后对象我们需要进行 wrap 包装,同时由于是 Map,因此 key 可以是一个对象,因此也需要包裹成为响应式
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
  // 这里迭代器和 forEach 差不多,我们也需要将 value 包裹一下成为依赖,确保在 effect 中访问这些 value 身上的属性时,能够和当前的 effect 产生依赖关系
  return function (this: IterableCollections, ...args: unknown[]): Iterable & Iterator {
    // 此时的 target 是代理对象,首先获取原始对象
    const target = (this as any)[ReactiveFlags.RAW]
    // 防止嵌套响应式 readonly(reactive(map))
    const rawTarget = toRaw(target)
    // 判断最原始对象是否为 Map,因为这里可能是 Set 集合
    const targetIsMap = isMap(rawTarget)
    // 遍历 map fro...of
    const isPair = method === 'entries' || (method === Symbol.iterator && targetIsMap)
    // 遍历 map for...in
    const isKeyOnly = method === 'keys' && targetIsMap
    // 拿到原始对象的这些方法后,进行调用: 'keys' | 'values' | 'entries' | Symbol.iterator  
    const innerIterator = target[method](...args)

    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive

    // 根据当前的 isKeyOnly 区分 Map 和 Set 的全局 Symbol 值
    /**
     *  const p = reactive(new Map([
     *    ['key1', 'value1'],
     *    ['key2', 'value2']
     * ]))
     * effect(() => {
     *      for (const value of p.keys()) {
     *         console.log(value) // key1 key2
     *      }
     * })
     * 
     * p.set('key2', 'value3') // 这是一个 SET 类型的操作，它修改了 key2 的值
     * 
     * 为了避免这种不必要的更新触发发生,我们用另一个 Symbol 值来收集 for...of map 的 keys 依赖
     * 这样在进行 ADD 或者 DELETE 操作的时候,不仅仅需要执行 ITERATE_KEY 的依赖,还要执行 MAP_KEY_ITERATE_KEY 的依赖
     */
    !isReadonly && track(rawTarget, isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY, TrackOpTypes.ITERATE)

    return {
      next() {
        // 调用原始对象的 next 方法,拿到 value 和 done 值 
        const { value, done } = innerIterator.next()
        return done // 如果为真,说明遍历完毕
          ? { value, done } // 返回 value 和 done 值 {value: undefined,done: true}
          : { // 没有遍历完 , 判断当前原始对象是否为 map ,并且触发的是entries方法或者Symbol.iterator方法, 来确定 value 的返回类型 , 这里通forEach一样,也需要对 key 和 value 进行包裹
            // entries | Symbol.iterator && Map 第一个,values | keys | Symbol.iterator && Set 第二个
            value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
            done
          }
      },
      /**
       * 为什么需要加 [Symbol.iterator] 这个属性,我们知道对于 Map 来说,map.entries === map[Symbol.iterator]
       * p 需要符合可迭代协议,即实现 Symbol.iterator 方法,我们重写了这个方法,for...of 执行的时候会访问代理对象,p[Symbol.itrator] 触发getter,这里是ok的
       * 但是我们 for(const [key,value] of p.entires() ) 的时候会报错,很显然我们返回的是 {next()} 这个对象,这个对象只是符合了迭代器协议,因为包含next方法,但是不是可迭代协议
       * 
       * for(const [key,value] of p){ 
       *      console.log(key,value)
       *  }
       * 
       *  因此我们加上 [Symbol.iterator],使之符合可迭代协议
       *  [Symbol.iterator]() {
       *      因为调用 for...of p.entries() 的时候,会访问返回对象的 [Symbol.iterator] 方法,我们在这里实现了
       *      return this
       *  }
       *        
       *          
       */
      [Symbol.iterator]() {
        // 这里的 this 指向对象本身,即 return 的这个对象本身
        return this
      }
    }
  }
}

function createReadonlyMethod(type: TriggerOpTypes): Function {
  return function (this: CollectionTypes, ...args: unknown[]) {
    // if (__DEV__) {
    //   const key = args[0] ? `on key "${args[0]}" ` : ``
    //   console.warn(
    //     `${capitalize(type)} operation ${key}failed: target is readonly.`,
    //     toRaw(this)
    //   )
    // }
    return type === TriggerOpTypes.DELETE ? false : this
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

  const shallowInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, false, true)
    },
    get size() {
      return size(this as unknown as IterableCollections)
    },
    has,
    add,
    set,
    delete: deleteEntry,
    clear,
    forEach: createForEach(false, true)
  }

  const readonlyInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, true)
    },
    get size() {
      return size(this as unknown as IterableCollections, true)
    },
    has(this: MapTypes, key: unknown) {
      return has.call(this, key, true)
    },
    add: createReadonlyMethod(TriggerOpTypes.ADD),
    set: createReadonlyMethod(TriggerOpTypes.SET),
    delete: createReadonlyMethod(TriggerOpTypes.DELETE),
    clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
    forEach: createForEach(true, false)
  }

  const shallowReadonlyInstrumentations: Record<string, Function> = {
    get(this: MapTypes, key: unknown) {
      return get(this, key, true, true)
    },
    get size() {
      return size(this as unknown as IterableCollections, true)
    },
    has(this: MapTypes, key: unknown) {
      return has.call(this, key, true)
    },
    add: createReadonlyMethod(TriggerOpTypes.ADD),
    set: createReadonlyMethod(TriggerOpTypes.SET),
    delete: createReadonlyMethod(TriggerOpTypes.DELETE),
    clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
    forEach: createForEach(true, true)
  }


  /**
   * 
   * 一个对象能否迭代，取决于该对象是否实现了迭代协议，如果一个对象正确地实现了 Symbol.iterator 方法，那么它就是可迭代的。很显然，代理对象 p 没有实现 Symbol.iterator 方法
   * 
   * 但实际上，当我们使用 for...of 循环迭代一个代理对象时，内部会试图从代理对象 p 上读取 p[Symbol.iterator] 属性，这个操作会触发 get 拦截函数
   * const p = reactive(new Map([
   *     ['key1', 'value1'],
   *     ['key2', 'value2']
   *  ]))
   *
   * effect(() => {
   *    // TypeError: p is not iterable
   *    for (const [key, value] of p) {
   *        console.log(key, value)
   *    }
   * })
   * 
   */
  const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]

  iteratorMethods.forEach(method => {
    // 为 mutableInstrumentations 新增keys values entries 方法
    mutableInstrumentations[method as string] = createIterableMethod(
      method,
      false,
      false
    )

    readonlyInstrumentations[method as string] = createIterableMethod(
      method,
      true,
      false
    )

    shallowInstrumentations[method as string] = createIterableMethod(
      method,
      false,
      true
    )

    shallowReadonlyInstrumentations[method as string] = createIterableMethod(
      method,
      true,
      true
    )
  })


  return [
    mutableInstrumentations,
    readonlyInstrumentations,
    shallowInstrumentations,
    shallowReadonlyInstrumentations
  ]
}

const [
  mutableInstrumentations,
  readonlyInstrumentations,
  shallowInstrumentations,
  shallowReadonlyInstrumentations
] = createInstrumentations()




// handles 工厂函数
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = shallow
    ? isReadonly
      ? shallowReadonlyInstrumentations
      : shallowInstrumentations
    : isReadonly
      ? readonlyInstrumentations
      : mutableInstrumentations

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

export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, true)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(true, false)
}

export const shallowReadonlyCollectionHandlers: ProxyHandler<CollectionTypes> =
{
  get: createInstrumentationGetter(true, true)
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


