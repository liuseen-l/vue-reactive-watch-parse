import { test, expect, describe, vi } from 'vitest'
import { effect } from '../src/effect';
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";
import { ref } from '../src/ref';

describe('ref', () => {

  test("ref 设置 reactive", () => {
    let original = { a: 1 };
    // let s = shallowReactive(original);
    let r = reactive(original)

    let obj = ref(r);
    const fnSpy = vi.fn()
    effect(() => {
      obj.value // 收集了2次依赖
      fnSpy()
    });

    obj.value = r
    expect(fnSpy).toBeCalledTimes(1)
  })


  test("ref 设置 shallowReactive", () => {
    let original = { a: 1 };
    // let s = shallowReactive(original);
    let r = shallowReactive(original)

    let obj = ref(r);
    const fnSpy = vi.fn()
    effect(() => {
      obj.value// 收集了2次依赖
      fnSpy()
    });

    obj.value = r
    expect(fnSpy).toBeCalledTimes(2)
  })

})