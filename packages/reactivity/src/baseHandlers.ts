import { isReadonly, isShallow, reactive, ReactiveFlags, readonly, Target, toRaw } from './reactive'
import { ITERATE_KEY, pauseTracking, resetTracking, track, trigger } from './effect'
import { extend, hasChanged, hasOwn, isArray, isIntegerKey, isObject, isSymbol } from '@vue/shared'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { warn } from './warning'
import { makeMap } from './makeMap'
import { isRef } from './ref'


const arrayInstrumentations = createArrayInstrumentations()

function hasOwnProperty(key: string) {
  // 拿到原始对象
  const obj = toRaw(this)
  track(obj, key, TrackOpTypes.HAS)
  return obj.hasOwnProperty(key)
}


function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {};

  (['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {

    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // 这里的 this 是数组的代理对象，这里通过 toRaw 拿到代理数组的原始数组
      const arr = toRaw(this) as any
      // 实现 includes 访问每个元素，建立依赖关系，不重写其实还会和length建立依赖关系，主要用于在effect中 reactvie(['bar']).includes('bar') ,然后修改 arr[0]='foo',需要重新执行effect
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, i + '', TrackOpTypes.GET)
      }
      // 现在的 includes 都是拿代理数组的原始数组中的原始元素和传入的参数比较了，之前不重写时，会有一些代理的操作进来，现在更纯粹
      /**
       * 将用户传入的args参数，传递给原始数组对象的 ['includes', 'indexOf', 'lastIndexOf'] 方法，去拿到结果,这一步针对于args不是响应式的。如下：
       * const obj = {};
       * const arr = reactive([obj]);
       * expect(arr.includes(obj)).toBe(true)
       *  */
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        /**
         * 这一步针对于args是响应式的。拿到arr[0]的原始对象如下
         * const obj = {};
         * const arr = reactive([obj]);
         * expect(arr.includes(arr[0])).toBe(true)
         */
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  });

  (['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // 屏蔽 length 与当前 effect 的依赖关系
      pauseTracking()
      /**
       * 当前的 this 是原始对象的代理对象，因此先 toRaw 获取原始对象的方法，不然就是无线递归了，因为this[key]又是调当前方法了。
       * 这样调用push时，为什么要将方法内部的 this 设置为当前的代理对象呢 ？
       * 因为 push 方法不止访问和设置 length，而且还会触发当前 push 的索引的 setter，比如现在 arr = reactive([obj])只有一个元素，那么
       * 我们 push 的时候就会实现 arr[1] = xxx 的操作，这是一个ADD操作，我们应该取出length相关联的 effect 并执行，而这一切都需要触发setter才行
       * 因此需要将 this 调整为原始数组的代理对象，而我们调用这个方法的时候是通过代理对象调用的，因此this指向的就是代理对象。如果在这里不用apply
       * 调用的话，就是原始数组调用，[obj][1] = xxx ,这不会触发setter，也就不会将 length 相关的effect取出来执行
       */
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}

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

    // 判断当前的target是否为数组
    const targetIsArray = isArray(target)

    /**
     * arr.includes 相当于访问 arr 的 includes 属性，因此在这里可以拦截，返回重写的 includes
     * 首先判断当前的target是否是由 readonly(['foo']) 代理的，如果是 true 这个时候其实走正常逻辑就可以，不需要拦截，因为设置为只读
     * hasOwn(arrayInstrumentations, key) 判断当前的 key 所对应的数组方法是否在重写序列中
     *  */
    if (!isReadonly) {
      // recevier 是数组的代理，这里放回重写的方法，并将方法当中的 this 改为 recevier
      if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }
      if (key === 'hasOwnProperty') {
        return hasOwnProperty
      }
    }
    const res = Reflect.get(target, key, receiver)

    // 因为for of 数组的时候，会访问Symbol.iterator，为了不让他和effect建立依赖关系，需要进行判断，并直接返回res
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

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
  return function set(target: object, key: string | symbol, value: unknown, receiver: object): boolean { // receiver是代理对象的本身
    // 拿到旧值,便于触发更新前的比较
    let oldValue = (target as any)[key]

    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }

    if (!shallow) {
      if (!isShallow(value) && !isReadonly(value)) {
        // 防止污染原始数据
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

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
        trigger(target, key, TriggerOpTypes.ADD, value)
      } else if (hasChanged(value, oldValue)) { // 如果我们修改的属性值和原来的值一样，没必要去更新，影响性能
        trigger(target, key, TriggerOpTypes.SET, value)
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

// 浅只读模块
const shallowReadonlyGet = createGetter(true, true)
export const shallowReadonlyHandlers = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)
const builtInSymbols = new Set(
  /*#__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)
