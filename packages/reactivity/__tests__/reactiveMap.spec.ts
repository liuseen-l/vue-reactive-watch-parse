import { test, expect, describe, vi } from 'vitest'
import { effect } from '../src/effect';
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";


describe('reactiveMap', () => {

  test("Map获取操作", () => {
    const obj = { a: 1 }
    const map_ = new Map([]);
    const map = reactive(map_);
    const fnSpy = vi.fn()
    effect(() => {
      map.get(obj)
      fnSpy()
    })
    map.set(obj, 1)
    expect(fnSpy).toBeCalledTimes(2)
  })

  test("MAp 操作 get,has 等时候会收集 key 和 rawKey", () => {
    const original = { a: 1 };
    const obj = reactive(original);
    const map = reactive(new Map([[obj, 1]])); 
    const fnSpy = vi.fn()
    effect(() => {
      map.get(obj);
      fnSpy()
    });
    //  如果不收集原始 rawKey 这里不会触发
    map.set(original, 2)

    expect(fnSpy).toBeCalledTimes(2)
  })

})