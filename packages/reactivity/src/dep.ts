
import { ReactiveEffect } from './effect'

export type Dep = Set<ReactiveEffect> 
// & TrackedMarkers

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
