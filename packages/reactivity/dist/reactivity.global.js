var VueReactivity = (function (exports) {
  'use strict';

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
           *
           * 防止死循环，比如
           * effect(()=>{
           *    state.name = Math.Romdom()
           * })
           *
           *
           */
          if (!effectStack.includes(this)) { // 屏蔽同一个effect会多次执行 
              try {
                  // 激活状态的话，需要建立属性和依赖的关系
                  activeEffect = this;
                  effectStack.push(activeEffect);
                  return this.fn(); // 访问data的属性，触发getter （依赖收集）
                  // activeEffect = effectStack.pop()
              }
              finally {
                  effectStack.pop(); // 嵌套副作用函数执行完毕以后将最里层的副作用函数pop出去
                  activeEffect = effectStack[effectStack.length - 1];
              }
          }
      }
      stop() {
      }
  }
  const targetMap = new WeakMap();
  function isTracking() {
      return activeEffect !== undefined;
  }
  // 追踪 一个属性对应多个effect 多个属性对应一个effect
  function track(target, key) {
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
      let deps = depsMap.get(key);
      if (!deps) {
          // 创建当前字段装副作用函数的小桶
          deps = new Set();
          depsMap.set(key, deps);
      }
      // 为当前字段(小桶)添加副作用函数,这个副作用函数当前是激活的
      // 无论是首次调用effect()函数，还是trigger触发更新，都会走这一步，由于trigger触发更新的时候，activeEffect引用的对象是相同的，Set会自动过滤重复的
      // 有了cleanup函数之后，每次触发前都进行了依赖删除，那么就不会触发Set的自动过滤了
      let shouldTrack = deps.has(activeEffect);
      if (shouldTrack) {
          deps.add(activeEffect);
      }
  }
  function effect(fn, options) {
      const _effect = new ReactiveEffect(fn);
      _effect.run(); // 默认让fn执行一次
  }

  // 判断传入的数据是否为对象类型
  const isObject = (val) => val !== null && typeof val === 'object';

  const mutableHandlers = {
      get(target, key, recevier) {
          // 如果target已经被代理过了就直接返回true
          if (key === "__v_isReactive" /* ReactiveFlags.IS_REACTIVE */) {
              return true;
          }
          // 触发getter收集副作用函数effect
          track(target, key);
          return Reflect.get(target, key, recevier);
      },
      set(target, key, value, recevier) {
          return Reflect.set(target, key, value, recevier);
      }
  };
  const reactiveMap = new WeakMap(); // 缓存代理过的target
  // 工厂函数
  function createReactiveObject(target) {
      // 判断传入的数据是否为对象
      if (!isObject(target)) {
          // __DEV__用于判断当前的代码编写环境为开发环境的时候，发出警告，因此在生产环境下这段代码为dead code，利用tree-shaking(依赖于ES Module)移除掉
          {
              console.warn(`value cannot be made reactive: ${String(target)}`);
          }
          return target;
      }
      // 判断target是否被代理过，如果target是一个响应式对象，这里会触发getter(主要针对于target是一个响应式对象，如果target是原始对象不会触发getter，只有响应式对象才会触发getter)
      if (target["__v_isReactive" /* ReactiveFlags.IS_REACTIVE */]) {
          return target;
      }
      // 优先通过原始对象 obj 寻找之前创建的代理对象，如果找到了，直接返回已有的代理对象，简单的说就是代理过的对象不再重复代理，取出之前创建的代理对象返回
      const existionProxy = reactiveMap.get(target);
      if (existionProxy)
          return existionProxy;
      const proxy = new Proxy(target, mutableHandlers); // 数据劫持
      reactiveMap.set(target, proxy); // 缓存
      return proxy; // 返回代理
  }
  function reactive(target) {
      return createReactiveObject(target);
  }

  exports.effect = effect;
  exports.reactive = reactive;

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;

})({});
//# sourceMappingURL=reactivity.global.js.map
