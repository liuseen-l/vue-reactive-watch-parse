import { defineConfig } from "vitest/config";
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
    include: ["**/__tests__/reactiveArray.spec.ts"],
    exclude: ["**/node_modules/**", " **/dist/**"]
  }
});