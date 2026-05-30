import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    orchestration: 'src/orchestration/index.ts',
    memory: 'src/memory/index.ts',
    collaboration: 'src/collaboration/index.ts',
    communication: 'src/communication/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: process.env.NODE_ENV === 'production',
  external: [],
  noExternal: [],
});
