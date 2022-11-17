import { test, expect, describe} from 'vitest'
import { reactive, readonly, shallowReactive, shallowReadonly } from "../src/reactive";

describe('reactiveArray', () => {

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

  test('shallowReadonly for Array', () => {
    const obj = {};
    const arr = shallowReadonly([obj]);
    expect(arr.includes(obj)).toBe(true)
  })


})