import { test, expect, describe, it } from 'vitest'
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";
import { effect } from "../src/effect"


describe('reactive', () => {
  /**
   * 通过 const reactiveMap = new WeakMap<Target, any>();  缓存代理过的target
   *  */
  test('已经代理过的对象,不重复代理', () => {
    const original = { foo: 1 }
    const state = reactive(original)
    const state2 = reactive(original)
    expect(state === state2).toBe(true)
  })

  /**
   * 通过 target[ReactiveFlags.IS_REACTIVE] 来进行判断,因为这个会触发响应式对象的getter
   */
  test('已经是代理对象,返回代理对象本身', () => {
    const original = { foo: 1 }
    const state = reactive(original)
    const state2 = reactive(state)
    expect(state === state2).toBe(true)
  })

  /**
    * console.log(isReadonly);
    * console.log(target[ReactiveFlags.IS_REACTIVE]);
    * false
    * false
    */
  test('shallowReactive and readonly', () => {
    const state_readonly = readonly({ foo: 1 })
    const state_shallowReactive = shallowReactive(state_readonly)
    expect(state_readonly === state_shallowReactive).toBe(true)
  })

  /**
    * console.log(isReadonly);
    * console.log(target[ReactiveFlags.IS_REACTIVE]);
    * false
    * false
    */
  test('reactive and readonly', () => {
    const state_readonly = readonly({ foo: 1 })
    const state_reactive = reactive(state_readonly)
    expect(state_readonly === state_reactive).toBe(true)
  })

  /**
    * console.log(isReadonly);
    * console.log(target[ReactiveFlags.IS_REACTIVE]);
    * true
    * true
    */
  test("readonly and shallowReactive", () => {
    const state_shallowReactive = shallowReactive({ foo: 1 })
    const state_readonly = readonly(state_shallowReactive)
    expect(state_readonly === state_shallowReactive).toBe(false)
  })

  /**
   * console.log(isReadonly);
   * console.log(target[ReactiveFlags.IS_REACTIVE]);
   * true
   * true
   */
  test('readonly and reactive', () => {
    const state_reactive = reactive({ foo: { bar: 1 } })
    const state_readonly = readonly(state_reactive)
    expect(state_readonly === state_reactive).toBe(false)
    expect(state_reactive.foo === state_readonly.foo).toBe(false) // reactive({bar:1}) !== readonly(reactive({bar:1}))
  })

  test('shallowReadonly and reactive', () => {
    const state_reactive = reactive({ foo: { bar: 1 } })
    const state_readonly = shallowReadonly(state_reactive)
    expect(state_readonly === state_reactive).toBe(false)
    expect(state_reactive.foo === state_readonly.foo).toBe(true) //  reactive({bar:1}) ==== reactive({bar:1})
  })

  test("includes,通过reactiveMap缓存，防止创建不同的proxy实例，但最后还是重写了includes，进行其他方式的优化", () => {
    const obj = {};
    const arr = reactive([obj]);
    expect(arr.includes(arr[0])).toBe(true)
  })

  test("includes,inlucdes内部会访问索引，如果索引的元素是对象，返回的时候reactive会进行代理，因此是这个代理对象和传入的数据进行比较，需要重写includes", () => {
    const obj = {};
    const arr = reactive([obj]);
    expect(arr.includes(obj)).toBe(true)
  })

  test('readonly for Array', () => {
    const obj = {};
    const arr = readonly([obj]);
    expect(arr.includes(obj)).toBe(false)
    // false is bug? 内部访问索引元素会被readonly包裹一层，但是obj是个原始对象，比较起来显然不一致
  })

})