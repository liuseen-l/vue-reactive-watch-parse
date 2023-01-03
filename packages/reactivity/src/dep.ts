
import { ReactiveEffect, trackOpBit } from './effect'


export type Dep = Set<ReactiveEffect> & TrackedMarkers

 // w 不为 0 表示这个依赖之前被收集过，n 表示在在重新执行副作用函数的时候这个依赖有没有被重新收集
type TrackedMarkers = {
  /**
   * wasTracked
   */
  w: number
  /**
   * newTracked
   */
  n: number
}


export const createDep = (effects?: ReactiveEffect[]): Dep => {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  dep.w = 0
  dep.n = 0
  return dep
}

export const wasTracked = (dep: Dep): boolean => (dep.w & trackOpBit) > 0

export const newTracked = (dep: Dep): boolean => (dep.n & trackOpBit) > 0

// 对 w 的一个操作
export const initDepMarkers = ({ deps }: ReactiveEffect) => {
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].w |= trackOpBit // set was tracked
    }
  }
}

export const finalizeDepMarkers = (effect: ReactiveEffect) => {
  const { deps } = effect
  if (deps.length) {
    let ptr = 0
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i]
      // 这里是分支切换的核心地方，没有像之前上来先调用 cleanupEffect 清空之前收集的依赖，而是在这里进行删除
      // 因为 trigger 导致副作用函数的重新执行，依赖(dep)的 dep.w 就会被赋值不会0，那么 wasTracked(dep) 返回的一定为true ,只要没有走 track，dep.n 就一定为 0 那么 !newTracked(dep) 返回的也是真，就会删除
      // w 不为 0 表示这个依赖之前被收集过，n 表示在在重新执行副作用函数的时候这个依赖有没有被重新收集
      if (wasTracked(dep) && !newTracked(dep)) {
        dep.delete(effect)
      } else {
        deps[ptr++] = dep
      }
      // 清空
      // 第一次执行完effect之后 w = 0000 0000 , trackOpBit = 0000 0010 , ~trackOpBit = 1111 1101 
      // n 是通过  dep.n |= trackOpBit， 第一次执行完effect之后 n = 0000 0010 , trackOpBit = 0000 0010 , ~trackOpBit = 1111 1101 
      // 重新置为0，保证下一次重新这些 effect 的时候 上来的 w 和 n 标记初始化都为 0
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    // 更新 deps 的数据
    deps.length = ptr
  }
}
