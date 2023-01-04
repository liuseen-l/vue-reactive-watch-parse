import { test, expect, describe, vi } from 'vitest'

describe('ref', () => {

  test("ref 设置 reactive", () => {
    const fnSpy = vi.fn()
    fnSpy()
    expect(fnSpy).toBeCalledTimes(1)
  })

})