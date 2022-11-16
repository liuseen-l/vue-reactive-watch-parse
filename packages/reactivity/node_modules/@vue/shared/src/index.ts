// 判断传入的数据是否为对象类型
export const isObject = (val: unknown): val is Record<any, any> => val !== null && typeof val === 'object'


// 判断是否是一个函数
export const isFunction = (val: unknown): val is Function => typeof val === 'function'


// computed要用
export const NOOP = () => { }


// 判断数组
export const isArray = Array.isArray


// 判断Map
export const isMap = (val: unknown): val is Map<any, any> => toTypeString(val) === '[object Map]'
export const objectToString = Object.prototype.toString
export const toTypeString = (value: unknown): string => objectToString.call(value)


export const extend = Object.assign


// 判断当前访问的key是否是target自身的属性
const hasOwnProperty = Object.prototype.hasOwnProperty
export const hasOwn = (
  val: object,
  key: string | symbol
): key is keyof typeof val => hasOwnProperty.call(val, key) // 相当于obj.hasOwnProperty(key)


export const isString = (val: unknown): val is string => typeof val === 'string'
// 判断是否是一个number类型的key
export const isIntegerKey = (key: unknown) => isString(key) && key !== 'NaN' && key[0] !== '-' && '' + parseInt(key, 10) === key


// 判断值是否发生变化 Object.is 比 == 甚至 === 更严格，== 会类型转换，0 -0 ===会相等，而 Object.is 返回false
export const hasChanged = (value: any, oldValue: any): boolean => !Object.is(value, oldValue)


export const toNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}