

// 判断传入的数据是否为对象类型
export const isObject = (val: unknown): val is Record<any, any> => val !== null && typeof val === 'object'
