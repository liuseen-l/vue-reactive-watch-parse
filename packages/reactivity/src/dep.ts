
import { ReactiveEffect, trackOpBit } from './effect'


export type Dep = Set<ReactiveEffect> & TrackedMarkers

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
      if (wasTracked(dep) && !newTracked(dep)) {
        dep.delete(effect)
      } else {
        deps[ptr++] = dep
      }

      // 清空
      // 第一次执行完effect之后 w = 0000 0000 , trackOpBit = 0000 0010 , ~trackOpBit = 1111 1101 
      // n 是通过  dep.n |= trackOpBit， 第一次执行完effect之后 n = 0000 0010 , trackOpBit = 0000 0010 , ~trackOpBit = 1111 1101 
      dep.w &= ~trackOpBit
      dep.n &= ~trackOpBit
    }
    // 更新 deps 的数据
    deps.length = ptr
  }
}
