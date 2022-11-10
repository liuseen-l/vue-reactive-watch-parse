const minimist = require('minimist');
const execa = require('execa');


const args = minimist(process.argv.slice(2)) // 获取package.json script 我们自定义的命令行参数
console.log(args);

// 获取执行命令时 打包的参数
const target = args._.length ? args._[0] : 'reactivity'
const formats = args.f || 'global'; // esm-bunlder global cjs
const sourcemap = args.s || false

// react-app
// execa 表示执行脚本，相当于用代码的方式代替去终端手动执行命令
execa('rollup', [
  '-wc', // --watch --config  希望使用开发文件和观测文件的变化，就是rollup.config.js
  '--environment',  // 环境变量 --environment xx:xx , xx:xx
  [
    `TARGET:${target}`,
    `FORMATS:${formats}`,
    sourcemap ? `SOURCE_MAP:true` : ``
  ].filter(Boolean).join(',') //filter 过滤掉sourcemap可能为false，配置环境变量的参数
], {
  stdio: 'inherit', // 这个子进程的输出是在我们当前命令行中输出的
})


// pnpm run dev ->node dev.js
// dev.js -> rolliup打包 -> rollup.config.js