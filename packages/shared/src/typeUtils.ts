export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never

// make keys required but keep undefined values
export type LooseRequired<T> = { [P in keyof (T & Required<T>)]: T[P] }

// If the type T accepts type "any", output type Y, otherwise output type N.
export type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N
