import path from 'path';
import ts from 'rollup-plugin-typescript2';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'


const packageFormats = process.env.FORMATS && process.env.FORMATS.split(',') // formates 有可能是一个数组
const sourcemap = process.env.SOURCE_MAP; // process.env 这些参数就是execa 传递的参数

// 需要根据target 找到要打包的目录
const packagesDir = path.resolve(__dirname, 'packages');   // /monorope2/packages
const packageDir = path.resolve(packagesDir, process.env.TARGET); // 要打包的入口 monorope2/packages/reactivity
const resolve = p => path.resolve(packageDir, p); // 以打包的目录解析文件  monorope2/packages/reactivity/package.json
// packageFormats = process.env.FORMATS（这个东西是dev.js中const formats = args.f || 'global'的配置）这里args.f是命令行参数
const packageConfigs = packageFormats || pkg.buildOptions.formats; //    稍后打包所有文件的时候 可能不会有packageFormats值
const name = packageConfigs.filename || path.basename(packageDir); // 可以取到打包的名字了 reactivity 
const pkg = require(resolve('package.json')); // 拿到package.json中的内容

const outputConfig = {
  'esm-bundler': {
    file: resolve(`dist/${name}.esm-bundler.js`),
    format: 'es'
  },
  'cjs': {
    file: resolve(`dist/${name}.cjs.js`),
    format: 'cjs'
  },
  'global': {
    file: resolve(`dist/${name}.global.js`),
    format: 'iife'
  }
}


function createConfig(format, output) {
  output.sourcemap = sourcemap; // 添加sourcemap  
  output.exports = 'named';
  let external = []; // 外部模块 哪些模块不需要打包
  if (format === 'global') {
    output.name = pkg.buildOptions.name // VueReactivity
  } else {
    external = [...Object.keys(pkg.dependencies)]; // 如果是es6 cjs 不需要打包shared
  }
  return { // createConfig的结果就是rollup的配置
    input: resolve(`src/index.ts`),
    output,
    external,
    plugins: [
      json(),
      ts(), // 将ts转化成js文件
      commonjs(),
      nodeResolve()
    ]
  }
}
// 返回数组 会进行依次的打包
export default packageConfigs.map(format => createConfig(format, outputConfig[format]))

// 19继续
// npm run build


