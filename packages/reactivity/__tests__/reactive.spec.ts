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

  /**
   * 存在for in循环的时候,用Symbol和副作用函数建立依赖关系,触发Add操作的时候,需要将这些副作用函数拿出来重新执行
   */
  test('for in', () => {
    const original = { foo: 1, bar: 1 }
    const state = reactive(original)
    let count = 0
    effect(() => {
      count++
      for (const key in state) {
      }
    })
    state.age = 3
    expect(count).toBe(2)
  })

  /**
   * 当读取 child.bar 属性值时，由于child 代理的对象 obj 自身没有 bar 属性，因此会获取对象 obj 的原型，也就是 parent 对象，所以最终得到的实际上是 parent.bar
   * 的值。但是大家不要忘了，parent 本身也是响应式数据，因此在副作用函数中访问 parent.bar 的值时，会导致副作用函数被收集，从而也建立响应联系。所以我们能够得出
   * 一个结论，即 child.bar 和parent.bar 都与副作用函数建立了响应联系。
   * 
   * 如果设置的属性不存在于对象上，那么会取得其原型，并调用原型的 [[Set]] 方法，也就是 parent 的 [[Set]] 内部方法。由于 parent 是代理对象，所以这就相当于执行了
   * 它的 set 拦截函数。换句话说，虽然我们操作的是 child.bar，但这也会导致 parent 代理对象的 set 拦截函数被执行。前面我们分析过，当读取child.bar 的值时，副作用
   * 函数不仅会被 child.bar 收集，也会被parent.bar 收集。所以当 parent 代理对象的 set 拦截函数执行时，就会触发副作用函数重新执行，这就是为什么修改 child.bar
   * 的值会导致副作用函数重新执行两次。
   * 
   *  child 的 set 拦截函数
   *  set(target, key, value, receiver) { 
   *     target 是原始对象 obj 
   *     receiver 是代理对象 child
   *  }
   * 
   *  parent 的 set 拦截函数
   *  set(target, key, value, receiver) { 
   *     target 是原始对象 proto 
   *     receiver 是代理对象 child
   *  }
   * 
   * 我们发现，当 parent 代理对象的 set 拦截函数执行时，此时 target 是原始对象 proto，而 receiver 仍然是代理对象 child，
   * 而不再是 target 的代理对象。通过这个特点，我们可以看到 target 和 receiver 的区别。由于我们最初设置的是 child.bar
   * 的值，所以无论在什么情况下，receiver 都是 child，而 target 则是变化的。根据这个区别，我们很容易想到解决办法，只需要判断
   * receiver 是否是 target 的代理对象即可。只有当 receiver 是 target 的代理对象时才触发更新，这样就能够屏蔽由原型引起的更新了。
   * 所以接下来的问题变成了如何确定 receiver 是不是 
   * 
   */
  test('原型链响应式-effect重复执行', () => {
    const obj = {}
    const proto = { bar: 1 }
    const child = reactive(obj)
    const parent = reactive(proto)
    // 使用 parent 作为 child 的原型
    Object.setPrototypeOf(child, parent)
    let count = 0
    effect(() => {
      count++
      console.log(child.bar) 
    })
    // 修改 child.bar 的值
    child.bar = 2 // 会导致副作用函数重新执行两次
    expect(count).toBe(2)
  })
})