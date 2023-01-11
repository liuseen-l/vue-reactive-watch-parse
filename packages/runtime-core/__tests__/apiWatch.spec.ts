import { reactive } from '@vue/reactivity';
import { test, expect, describe, vi } from 'vitest'
import { watch } from '../src/apiWatch'


describe('ref', () => {

  test("watch", () => {
    const fnSpy = vi.fn()

    const obj = reactive({ a: 1 });

    watch(
      obj,
      () => {
        fnSpy()
      }
    );

    obj.a++;

    expect(fnSpy).toBeCalledTimes(1)
  })

})