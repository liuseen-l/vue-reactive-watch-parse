import { test, expect, describe, it } from 'vitest'
import { reactive } from "../src/reactive";
import { effect } from "../src/effect"
import { computed } from '../src/computed'


describe('computed', () => {
  test("计算属性默认不执行", () => {
    const original = { foo: 1 };
    const state = reactive(original);
    let count = 0
    //计算属性默认不会执行
    computed(() => {
      count++
      // 计算属性的缓存
      return state.foo + 19;
    });
    expect(count).toBe(0)
  })

  /**
   * 这里首先需要考虑到触发run的不同方式
   *  1. 在创建effect的时候可以触发run
   *  2. trigger触发更新的时候会触发run
   *  3. computed中的调度器scheduler会触发run
   *  4. computed中get value中会触发run
   *  
   *  然后后分析set死循环的场景：
   *     @effects {Set} 
   *     for (const effect of effects) {
   *          effect.run   
   *     }
   *  
   *  这里在遍历执行effect的时候，run方法中会调用cleanupEffect方法，将当前effect从收集的set中删除，然后重新执行fn，重新执行fn的时候会触发getter，
   *  getter会收集依赖，执行完毕之后，继续回到for循环当中，由于这个时候我们又将effect添加回来了，因此他又会执行调用run方法，往返如此导致死循环，解决
   *  的办法其实很简单，只需要在for循环执行之前去判断一下我们传入的dep的数据类型，是Array类型还是Set类型,如果是Set类型的话，转换一下，如下
   *  const effects = isArray(dep) ? dep : [...dep]
   *  这样就不会导致死循环问题了
   */
  test("依赖触发，导致Set死循环", () => {
    const original = { foo: 1 };
    const state = reactive(original);
    //计算属性默认不会执行
    const myState = computed(() => {
      // 计算属性的缓存
      return state.foo + 19;
    });
    effect(() => {
      myState.value // 这样做的话相当于是个嵌套的effect,state.age收集了传给computed的副作用函数
    });

    // 需要通过.value 才执行
    state.foo++;

    expect(myState.value).toBe(21)
  })
})