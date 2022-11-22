import { test, expect, describe, vi } from 'vitest'
import { effect } from '../src/effect';
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";

describe('reactiveSet', () => {

  test("set增添操作", () => {
    const obj = { a: 1 }
    const set_ = new Set([obj]);
    const set = reactive(set_);
    const fnSpy = vi.fn()
    effect(() => {
      set.size
      fnSpy()
    })
    set.add({ a: 1 })
    expect(fnSpy).toBeCalledTimes(2)
  })


  test("set删除操作", () => {
    const obj = { a: 1 }
    const set_ = new Set([obj]);
    const set = reactive(set_);
    const fnSpy = vi.fn()
    effect(() => {
      set.size
      fnSpy()
    })
    set.delete(obj)
    expect(fnSpy).toBeCalledTimes(2)
  })



})