import { test, expect, describe, it } from 'vitest'
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";





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


  test('shallowReactive and reactive', () => {
    const state_reactive = reactive({ foo: { bar: 1 } })
    const state_readonly = shallowReactive(state_reactive)
    expect(state_readonly === state_reactive).toBe(true)
    expect(state_reactive.foo === state_readonly.foo).toBe(true) //  reactive({bar:1}) ==== reactive({bar:1})
  })

})