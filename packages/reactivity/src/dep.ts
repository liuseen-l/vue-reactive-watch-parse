
import { ReactiveEffect } from './effect'


export type Dep = Set<ReactiveEffect> 

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
  // dep.w = 0
  // dep.n = 0
  return dep
}
