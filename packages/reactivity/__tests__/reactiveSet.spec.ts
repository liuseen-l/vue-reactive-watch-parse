import { test, expect, describe } from 'vitest'
import { effect } from '../src/effect';
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";

describe('reactiveSet', () => {

  test("set增添操作", () => {
    const obj = { a: 1 }
    const set_ = new Set([obj]);
    const set = reactive(set_);
    let count = 0;
    effect(() => {
      set.size
      count++
    })
    set.add({ a: 1 })
    expect(count).toBe(2)
  })


  test("set删除操作", () => {
    const obj = { a: 1 }
    const set_ = new Set([obj]);
    const set = reactive(set_);
    let count = 0;
    effect(() => {
      set.size
      count++
    })
    set.delete(obj)
    expect(count).toBe(2)
  })


})