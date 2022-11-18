import { test, expect, describe } from 'vitest'
import { effect } from '../src/effect';
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";


describe('reactiveMap', () => {

  test("Map获取操作", () => {
    const obj = { a: 1 }
    const map_ = new Map([]);
    const map = reactive(map_);
    let count = 0;
    effect(() => {
      map.get(obj)
      count++
    })
    map.set(obj, 1)
    expect(count).toBe(2)
  })



})