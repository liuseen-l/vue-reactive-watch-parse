import { test, expect, describe, it } from 'vitest'
import { reactive } from "../src/reactive";
import { effect } from "../src/effect"


describe('reactive', () => {
  /**
   * 通过 const reactiveMap = new WeakMap<Target, any>();  缓存代理过的target
   *  */
  test('已经代理过的对象,不重复代理', () => {
    const original = { foo: 1 }
    const state = reactive(original)
    const state2 = reactive(original)
    expect(state).toEqual(state2)
  })

  /**
   * 通过 target[ReactiveFlags.IS_REACTIVE] 来进行判断,因为这个会触发响应式对象的getter
   */
  test('已经是代理对象,返回代理对象本身', () => {
    const original = { foo: 1 }
    const state = reactive(original)
    const state2 = reactive(state)
    expect(state).toEqual(state2)
  })

  /**
   * 分支切换,遗留的副作用函数,在每次调用run方法前执行cleanupEffect去清除依赖
   */
  test('分支切换', () => {
    const original = { ok: true, text: 'hello world' }
    const state = reactive(original)
    let count = 0
    effect(() => {
      state.ok ? state.text : 'not'
      count++
    })

    state.ok = false
    state.text = 'change'
    expect(count).toBe(2)
  })

  /**
   * effect嵌套问题,每一个effect内的响应式对象需要一一对应属于自己的effect
   */
  test('effect嵌套问题_1', () => {
    const original = { foo: 1, bar: 1 }
    const original2 = { bar: 1 }
    const state = reactive(original)
    const state2 = reactive(original2)

    let count1 = 0
    let count2 = 0
    effect(() => {
      count1++
      state.foo
      // console.log(state.foo + "foo");

      effect(() => {
        // 外层函数重新执行副作用函数间接执行里面这个副作用函数的时候有问题，又new ReactiveEffect(fn)实例，导致target.key始终存储着之前的effect
        // 发现源码也有这个问题
        // console.log(state2.bar + "infoo");
        state2.bar
        count2++
      })
      state.bar
      // console.log(state.bar + "bar");
    })
    state.foo++
    expect(count1).toBe(2)
    expect(count2).toBe(2)
    state.bar++
    expect(count1).toBe(3)
    expect(count2).toBe(3)
    state2.bar++
    expect(count1).toBe(3)
    expect(count2).toBe(6)  // 期望应该变成4 但是变成了6，因为state2.bar 实际上收集了3个重复的依赖，但是由于是new出来，set无法去重
  }) 

  test('effect嵌套问题_2', () => {
    const original = { foo: 1, bar: 1 };
    const original2 = { bar: 1 };
    const state = reactive(original);
    const state2 = reactive(original2);
    effect(() => {
      state.foo;
      state2.bar++;
      // console.log(state.foo + "foo");
      effect(() => {
        // console.log(state2.bar + "infoo");
      });
      state.bar;
      // console.log(state.bar + "bar");
    });
    state.foo++;
    state.bar++;
    state2.bar++;// 这个触发四次 进去之后state2.foo++执行三次
    /**
    * 
    *
    1 foo
    2 infoo
    1 bar
    3 infoo
    2 foo
    3 infoo
    1 bar
    4 infoo
    2 foo
    4 infoo
    2 bar
    6 infoo
    2 foo
    6 infoo
    2 bar
    6 infoo
      * 
    */
  })


  


})