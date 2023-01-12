import { defineConfig } from "vitest/config";
import alias from '@rollup/plugin-alias';

import path from 'path'

function _resolve(dir: string) {
  return path.resolve(__dirname, dir)
}

export default defineConfig({
  resolve: {
    alias: {
      '@vue/shared': _resolve('packages/shared/src/index.ts'),
    },
  },
  test: {
    // include: ["**/__tests__/*.spec.ts"],
    // exclude: ["**/node_modules/**", " **/dist/**"],
    // alias: {
    //   '^@vue/(.*?)$': _resolve('/packages/$1/src'),
    // }
  },
});
