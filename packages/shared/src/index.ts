

// 判断传入的数据是否为对象类型
export const isObject = (val: unknown): val is Record<any, any> => val !== null && typeof val === 'object'

// 判断是否是一个函数
export const isFunction = (val: unknown): val is Function => typeof val === 'function'

// computed要用
export const NOOP = () => {}


export const isArray = Array.isArray