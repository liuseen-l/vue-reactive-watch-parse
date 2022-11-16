var VueReactivity = (function (exports) {
  'use strict';

  // 判断传入的数据是否为对象类型
  const isObject = (val) => val !== null && typeof val === 'object';
  // 判断是否是一个函数
  const isFunction = (val) => typeof val === 'function';
  // computed要用
  const NOOP = () => { };
  // 判断数组
  const isArray = Array.isArray;
  // 判断Map
  const isMap = (val) => toTypeString(val) === '[object Map]';
  const objectToString = Object.prototype.toString;
  const toTypeString = (value) => objectToString.call(value);
  const extend = Object.assign;
  // 判断当前访问的key是否是target自身的属性
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const hasOwn = (val, key) => hasOwnProperty.call(val, key); // 相当于obj.hasOwnProperty(key)
  const isString = (val) => typeof val === 'string';
  // 判断是否是一个number类型的key
  const isIntegerKey = (key) => isString(key) && key !== 'NaN' && key[0] !== '-' && '' + parseInt(key, 10) === key;
  // 判断值是否发生变化 Object.is 比 == 甚至 === 更严格，== 会类型转换，0 -0 ===会相等，而 Object.is 返回false
  const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
  const toNumber = (val) => {
      const n = parseFloat(val);
      return isNaN(n) ? val : n;
  };

  /**
   * effect1(()=>{
   *    state.name
   *    effect2(()=>{
   *      state.age
   *    })
   *    state.slary
   * })
   *
   * effect1 -> name slary
   * effect2 -> age
   *
   * 用栈来处理，存储正确的关系
   */
  let effectStack = [];
  let activeEffect;
  const ITERATE_KEY = Symbol('iterate');
  const MAP_KEY_ITERATE_KEY = Symbol('Map key iterate');
  function cleanupEffect(effect) {
      // deps 是当前副作用函数身上的一个属性，这个属性中存储了那些object.key收集了当前effect所对应的set集合
      const { deps } = effect; // deps -> [set,set]
      if (deps.length) {
          for (let i = 0; i < deps.length; i++) {
              // 重新执行副作用函数的时候，将当前副作用函数从这个 deps 当中删除
              deps[i].delete(effect);
          }
          deps.length = 0;
      }
  }
  class ReactiveEffect {
      fn;
      scheduler;
      active = true;
      deps = []; // 让 effect 记录他依赖了哪些属性，同时要记录当前属性依赖了哪个effect 
      parent = undefined;
      constructor(fn, scheduler = null, scope) {
          this.fn = fn;
          this.scheduler = scheduler;
      }
      run() {
          // 如果不是激活状态
          if (!this.active) {
              return this.fn();
          }
          /**
           * 防止死循环，比如
           * effect(()=>{
           *    state.name = Math.Romdom()
           * })
           */
          if (!effectStack.includes(this)) { // 屏蔽同一个effect会多次执行 
              try {
                  // 激活状态的话，需要建立属性和依赖的关系
                  cleanupEffect(this); // 清空分支切换时遗留的副作用函数
                  activeEffect = this;
                  effectStack.push(activeEffect);
                  return this.fn(); // 访问data的属性，触发getter （依赖收集）
              }
              finally {
                  effectStack.pop(); // 嵌套副作用函数执行完毕以后将最里层的副作用函数pop出去
                  activeEffect = effectStack[effectStack.length - 1];
              }
          }
      }
      // 清除依赖关系，可以手动调用stop执行
      stop() {
          if (this.active) // 如果effect是激活的采取将deps上的effect移除
           {
              cleanupEffect(this);
              this.active = false; // 关闭当前effect的激活状态
          }
      }
  }
  const targetMap = new WeakMap();
  function isTracking() {
      return activeEffect !== undefined;
  }
  // 追踪 一个属性对应多个effect 多个属性对应一个effect
  function track(target, key, type) {
      // 判断这个 state.name 访问属性的操作是不是在 effect 中执行的，简单来说就是判断需不需要收集
      if (!isTracking()) { //如果这个属性不依赖于 effect 直接跳出
          return;
      }
      // 根据 target 从 '桶' 当中取得depsMap ,他是一个 Map 类型: key -> effetcs
      // 这行代码的含义就是从桶（大桶）当中拿出 target 对象所有字段的副作用函数集合（所有小桶）  
      let depsMap = targetMap.get(target);
      //如果当前target对象还没有它的大桶，就创建大桶
      if (!depsMap) {
          depsMap = new Map();
          targetMap.set(target, depsMap);
      }
      //这行代码的含义是，如果当前target对象有桶（大桶），那么从所有字段的副作用函数集合（所有小桶）中，取出当前key的副作用函数集合（小桶）
      let dep = depsMap.get(key);
      if (!dep) {
          // 创建当前字段装副作用函数的小桶
          dep = new Set();
          depsMap.set(key, dep);
      }
      trackEffects(dep);
  }
  function trackEffects(dep) {
      // 判断当前的副作用函数是否已经被收集过，收集过就不用再收集了，虽然set可以过滤重复的，但还是有效率问题
      let shouldTrack = !dep.has(activeEffect);
      // 如果是内层的effect 我们可以将之前的先清空掉
      // if (effectStack.length === 1) {
      //   dep.clear()
      // }
      if (shouldTrack) {
          dep.add(activeEffect);
          activeEffect.deps.push(dep); // 副作用函数保存自己被哪些 target.key 所收集
      }
  }
  /**
   *
   * @param target {Target }
   * @param key   { string | number | symbol }
   * @param type  { TriggerOpTypes }  触发更新的操作，修改，删除，新增
   * @param newValue  { unknown }  用于修改 arr.length = xxx 的时候，此时的 key == 'length' 而 newValue 就是修改的长度的值
   * @returns
   */
  function trigger(target, key, type, newValue) {
      // 设置新的值以后，取出当前target所对应的大桶
      const depsMap = targetMap.get(target);
      // 如果没有大桶直接返回,表明属性没有依赖任何的effect
      if (!depsMap)
          return;
      let deps = []; // [set,set]
      // 如果修改 arr.length，将索引大于等于 newValue(修改length的值) 的副作用函数取出来执行
      if (key === 'length' && isArray(target)) {
          const newLength = toNumber(newValue);
          depsMap.forEach((dep, key) => {
              if (key === 'length' || key >= newLength) {
                  deps.push(dep);
              }
          });
      }
      else {
          // 执行 target key 的副作用函数
          if (key !== void 0) { // 这里有个问题,就是当前trigger是由于增添属性触发的时候,这里 target key 会获取到undefined
              deps.push(depsMap.get(key));
          }
          switch (type) {
              // 只有当操作类型为 'ADD' 时，才触发 target 身上 key == ITERATE_KEY 相关联的副作用函数重新执行
              case "add" /* TriggerOpTypes.ADD */:
                  // 这里会进行不同的判断,因为保存增添操作所对应的副作用函数的标识符会根据数据类型不同而变化
                  if (!isArray(target)) { // 如果增添属性的对象是普对对象,取出for in的副作用函数
                      deps.push(depsMap.get(ITERATE_KEY));
                      if (isMap(target)) { // // 如果增添属性的对象是Map对象,取出Map所对应的for in副作用函数
                          deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
                      }
                  }
                  /**
                   *  这里为什么还需要 isIntergerKey 去判断 key 是否为符合数组的索引类型?
                   *    因为 TriggerOpTypes.ADD 只是确认了当前的属性为新增属性,当走到 else if (isIntegerKey(key)) 的时候
                   *    只能说明 target 是数组类型,但是不能确保key是不是符合数组的索引属性,因此需要判断一下
                   *  */
                  else if (isIntegerKey(key)) { // 如果为数组新增元素，应该触发与length相关的副作用函数
                      deps.push(depsMap.get('length'));
                  }
                  break;
              // 只有当操作类型为 'DELETE' 时，才触发 target 身上 key == ITERATE_KEY 相关联的副作用函数重新执行
              case "delete" /* TriggerOpTypes.DELETE */:
                  if (!isArray(target)) {
                      deps.push(depsMap.get(ITERATE_KEY));
                      if (isMap(target)) {
                          deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
                      }
                  }
                  break;
              case "set" /* TriggerOpTypes.SET */:
                  if (isMap(target)) {
                      deps.push(depsMap.get(ITERATE_KEY));
                  }
                  break;
          }
      }
      const effects = [];
      for (const dep of deps) { // dep -> set
          // 防止当前trigger是由于增添属性触发的时候,上面 deps.push(depsMap.get(key)) 会添加 undefined 到deps里面
          if (dep) {
              effects.push(...dep);
          }
      }
      triggerEffects(effects);
  }
  function triggerEffects(dep) {
      // 老问题出现了，因为我们传入的dep是Dep，一个set集合，遍历的时候执行run，run中将当前的effect从dep中删除，但是重新执行又添加进去，导致死循环
      const effects = isArray(dep) ? dep : [...dep];
      for (const effect of effects) {
          // 防止 effect 中同时执行和赋值导致死循环
          if (effect !== activeEffect) {
              if (effect.scheduler) {
                  return effect.scheduler();
              }
              effect.run();
          }
      }
  }
  function effect(fn, options) {
      const _effect = new ReactiveEffect(fn); // 这里导致嵌套函数有问题
      //合并
      if (options) {
          extend(_effect, options);
      }
      if (!options || !options.lazy) {
          _effect.run(); // 默认让fn执行一次
      }
      const runner = _effect.run.bind(_effect);
      runner.effect = _effect; // 给runner添加一个effect属性就是_effect实例
      // runner 可以强制重新执行effect
      return runner;
  }

  function warn(msg, ...args) {
      console.warn(`[Vue warn] ${msg}`, ...args);
  }

  function createGetter(isReadonly = false, shallow = false) {
      return function get(target, key, receiver) {
          // 如果target已经被代理过了就直接返回true
          if (key === "__v_isReactive" /* ReactiveFlags.IS_REACTIVE */) {
              return !isReadonly;
          }
          else if (key === "__v_isReadonly" /* ReactiveFlags.IS_READONLY */) {
              return isReadonly;
          }
          else if (key === "__v_isShallow" /* ReactiveFlags.IS_SHALLOW */) {
              return shallow;
          }
          else if (key === "__v_raw" /* ReactiveFlags.RAW */) {
              // 用于获取 receiver 的原始对象
              return target;
          }
          const res = Reflect.get(target, key, receiver);
          // 如果不是只读，触发getter收集副作用函数effect
          if (!isReadonly) {
              track(target, key);
          }
          // 如果是浅层次的读
          if (shallow) {
              return res;
          }
          // 如果返回的对象是对象，判断是否为 readonly ,如果是 readonly 那么递归调用readonly，保证深层次的对象也是只读的，reactive 同理，递归包裹深层次对象成为响应式，可以深层次的实现响应式
          if (isObject(res)) {
              return isReadonly ? readonly(res) : reactive(res);
          }
          return res;
      };
  }
  function createSetter(shallow = false) {
      return function set(target, key, value, receiver) {
          // 拿到旧值,便于触发更新前的比较
          let oldValue = target[key];
          /**
           *  # hadKey 这一步用来判断当前访问的key,是否是target自身的属性，如果是的话表示当前的set操作是修改数据，反之则是增添属性的操作
           *
           *  # hadKey 这一步其实有2个作用
           *    1.针对数组，判断原始数组是否有这个key
           *        如果当前的原始对象是数组类型，并且key是数字类型，或者字符串的数字类型( 0 or '0')，执行 Number(key) < target.length 判单数组有没有这个key
           *    2.针对对象，判断原始对象是否有这个key
           *        如果当前的原始对象是对象类型，执行 hasOwn(target, key) ，判断自身是否含有key（不包括原型链上的属性）
           */
          const hadKey = isArray(target) && isIntegerKey(key) ? Number(key) < target.length : hasOwn(target, key);
          // 需要先设置值，再去追踪，重新执行副作用函数，否者执行副作用函数的时候值没有发生变化
          const res = Reflect.set(target, key, value, receiver);
          // 这里判断当前代理对象的原始对象是否为target,防止原型链响应式对象触发 setter 导致重复触发 trigger
          if (target === toRaw(receiver)) {
              // 如果没有访问的key，无论是对于数组还是对象，都是新增属性
              if (!hadKey) {
                  trigger(target, key, "add" /* TriggerOpTypes.ADD */, value);
              }
              else if (hasChanged(value, oldValue)) { // 如果我们修改的属性值和原来的值一样，没必要去更新，影响性能
                  trigger(target, key, "set" /* TriggerOpTypes.SET */, value);
              }
          }
          return res;
      };
  }
  // 'foo' in p 
  function has(target, key) {
      const result = Reflect.has(target, key);
      track(target, key);
      return result;
  }
  // for key in p 
  function ownKeys(target) {
      // 判断当前遍历的对象是object类型还是数组类型
      const key = isArray(target) ? 'length' : ITERATE_KEY;
      track(target, key);
      return Reflect.ownKeys(target);
  }
  // 删除属性的时候触发
  function deleteProperty(target, key) {
      // 判断要删除的属性是否存在当前的target身上
      const hadKey = hasOwn(target, key);
      const result = Reflect.deleteProperty(target, key);
      // 当前 target 存在要删除的属性,并且成功删除了
      if (result && hadKey) {
          trigger(target, key, "delete" /* TriggerOpTypes.DELETE */);
      }
      return result;
  }
  // 深层次响应式模块的Handlers
  const get = createGetter();
  const set = createSetter();
  const mutableHandlers = {
      get,
      set,
      has,
      ownKeys,
      deleteProperty
  };
  // 浅层次响应式模块的Handlers
  const shallowGet = createGetter(false, true);
  const shallowSet = createSetter(true);
  const shallowReactiveHandlers = extend({}, mutableHandlers, 
  // 用 shallowReactiveHandlers 覆盖 mutableHandlers 当中的 get 和 set ，其余继承
  {
      get: shallowGet,
      set: shallowSet
  });
  // 只读模块的Handlers
  const readonlyGet = createGetter(true);
  const readonlyHandlers = {
      get: readonlyGet,
      set(target, key) {
          warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
          return true;
      },
      deleteProperty(target, key) {
          warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
          return true;
      }
  };
  // 浅只读模块
  const shallowReadonlyGet = createGetter(true, true);
  const shallowReadonlyHandlers = extend({}, readonlyHandlers, {
      get: shallowReadonlyGet
  });

  const reactiveMap = new WeakMap(); // 缓存代理过的target
  // 工厂函数
  function createReactiveObject(target, isReadonly, baseHandlers) {
      // 判断传入的数据是否为对象
      if (!isObject(target)) {
          // __DEV__用于判断当前的代码编写环境为开发环境的时候，发出警告，因此在生产环境下这段代码为dead code，利用tree-shaking(依赖于ES Module)移除掉
          {
              console.warn(`value cannot be made reactive: ${String(target)}`);
          }
          return target;
      }
      // 判断target是否被代理过，如果target是一个响应式对象，这里会触发getter(主要针对于target是一个响应式对象，如果target是原始对象不会触发getter，只有响应式对象才会触发getter)
      // && 后面的 判断用于 readonly(reactive(obj)) 这样的情况
      if (target["__v_raw" /* ReactiveFlags.RAW */] && !(isReadonly && target["__v_isReactive" /* ReactiveFlags.IS_REACTIVE */])) {
          // console.log(isReadonly);
          // console.log(target[ReactiveFlags.IS_REACTIVE]);
          return target;
      }
      // 优先通过原始对象 obj 寻找之前创建的代理对象，如果找到了，直接返回已有的代理对象，简单的说就是代理过的对象不再重复代理，取出之前创建的代理对象返回
      const existionProxy = reactiveMap.get(target);
      if (existionProxy) {
          return existionProxy;
      }
      const proxy = new Proxy(target, baseHandlers); // 数据劫持
      reactiveMap.set(target, proxy); // 缓存
      return proxy; // 返回代理
  }
  function shallowReactive(target) {
      return createReactiveObject(target, false, shallowReactiveHandlers);
  }
  function reactive(target) {
      return createReactiveObject(target, false, mutableHandlers);
  }
  function readonly(target) {
      return createReactiveObject(target, true, readonlyHandlers);
  }
  function shallowReadonly(target) {
      return createReactiveObject(target, true, shallowReadonlyHandlers);
  }
  function toRaw(observed) {
      // 如果传入的对象是一个响应式对象,例如reactive代理的响应式对象,可以访问该代理对象的'__v_raw'属性,这个属性会返回代理对象的原始对象
      const raw = observed && observed["__v_raw" /* ReactiveFlags.RAW */];
      // 如果这里获取到了原始对象,但是这个原始对象还可能是一个响应式对象,因此需要递归的去调用toRaw方法去获取原始对象,直到真正的获取到了原始对象
      return raw ? toRaw(raw) : observed;
  }
  const toReactive = (value) => 
  // 判断传入的原始数据是否为对象类型
  // 如果传入的原始数据是对象类型,那么调用reactive去进行代理,这里reactive内部其实也是进行了相关的优化,如果一个原始值已经是被代理过的,那么会直接返回已经代理的对象,就不用重新去代理了
  // 如果传入的原始数据不是对象类型,那么直接返回该数据
  isObject(value) ? reactive(value) : value;

  class ComputedRefImpl {
      _setter;
      dep = undefined;
      _value;
      effect; // 计算属性依赖于effect
      __v_isRef = true;
      _dirty = true; // 默认脏的
      ["__v_isReadonly" /* ReactiveFlags.IS_READONLY */] = false;
      constructor(getter, _setter, isReadonly) {
          this._setter = _setter;
          // 这里将计算属性包成一个effect , getter相当于effect当中的副作用函数
          this.effect = new ReactiveEffect(getter, () => {
              // 稍后计算属性的值发生变化了,不要重新执行getter,而是走第二个函数
              if (!this._dirty) {
                  this._dirty = true;
                  // 重新执行最外层的effect
                  triggerEffects(this.dep);
              }
          });
          this["__v_isReadonly" /* ReactiveFlags.IS_READONLY */] = isReadonly;
      }
      // 取值时, 编译完就是Object.defineProperty
      get value() {
          if (isTracking()) { //是否是在effect中取值的
              trackEffects(this.dep || (this.dep = new Set)); // 将外层的effect收集,相当于收集 computed.value -> Set(effect)
          }
          if (this._dirty) {
              // 缓存结果 
              this._dirty = false;
              this._value = this.effect.run();
          }
          return this._value;
      }
      set value(newValue) {
          this._setter(newValue); // 如果修改计算属性的值就走setter
      }
  }
  function computed(getterOrOptions) {
      // 判断传入的值是函数还是配置对象{get,set}
      const onlyGetter = isFunction(getterOrOptions);
      let getter;
      let setter;
      if (onlyGetter) {
          getter = getterOrOptions;
          setter = NOOP;
      }
      else {
          getter = getterOrOptions.get;
          setter = getterOrOptions.set;
      }
      return new ComputedRefImpl(getter, setter);
  }

  // ref入口函数
  function ref(value) {
      // 内部调用 createRef 函数，尾调用优化
      return createRef(value, false);
  }
  // 真正创建 ref 实例的构造韩素华
  function createRef(rawValue, shallow) {
      // 判断传入的值是否为ref的实例，如果是直接返回
      if (isRef(rawValue)) {
          return rawValue;
      }
      // 如果不是，调用RefImpl构造函数，即创建ref实例 ， value,false
      return new RefImpl(rawValue, shallow);
  }
  // ref
  class RefImpl {
      __v_isShallow;
      _value;
      _rawValue;
      dep = undefined;
      // 判断当前的实例是否为Ref对象
      __v_isRef = true;
      // 这里ref 的 __v_isShallow 为false，用于判断是不是浅层次的响应式,即判断调用的函数时shallowRef 还是 ref
      constructor(value, __v_isShallow) {
          this.__v_isShallow = __v_isShallow;
          // 这里传入的值可能是一个reactive代理的响应式对象，因此通过toRaw方法，返回reactive代理的原始对象
          this._rawValue = __v_isShallow ? value : toRaw(value); // 访问value['__v_raw]获取到原始对象并进行保存
          // 对原始数据进行代理
          this._value = __v_isShallow ? value : toReactive(value);
          /**
           *  执行到这里的时候,ref的实例已经是创建完成
           *    让我们回顾整个创建的过程
           *      1.首先我们是获取了传入的数据的原始数据
           *      2.判断原始数据的数据类型是否为对象类型,如果是对象调用 reactive 进行代理,反之返回原始数据
           *      3.将最终处理的数据保存在 _value 当中,基本数据类型就是基本数据类型,引用类型就通过 reactive 代理
           */
      }
      /**
       * 通过ref实例.value 获取到 _value 的值，_value值的类型根据 toReactive()的返回结果决定，
       * 如果不是对象就是原始值。如果是对象，返回的是通过 reactive() 包装后的对象，也就是通过 Proxy() 代理的
       */
      get value() {
          // 取值的时候依赖收集
          if (isTracking()) {
              trackEffects(this.dep || (this.dep = new Set()));
          }
          return this._value;
      }
      // 在这里，无论是ref还是shallowRef的实例对象，都是同样的方式进行存储
      set value(newVal) {
          // 设置值的时候触发更新
          if (newVal !== this._rawValue) {
              this._rawValue = newVal;
              this._value = toReactive(newVal);
              trackEffects(this.dep);
          }
      }
  }
  // 如果传入ref的对象，已经是 ref 的实例
  function isRef(r) {
      return !!(r && r.__v_isRef === true);
  }

  exports.computed = computed;
  exports.effect = effect;
  exports.reactive = reactive;
  exports.readonly = readonly;
  exports.ref = ref;
  exports.shallowReactive = shallowReactive;
  exports.shallowReadonly = shallowReadonly;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
//# sourceMappingURL=reactivity.global.js.map
