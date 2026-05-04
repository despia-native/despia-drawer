import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      core: 'src/core.ts',
      react: 'src/react.tsx',
      vue: 'src/vue.ts',
      svelte: 'src/svelte.ts',
      angular: 'src/angular.ts'
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    splitting: false,
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'vue',
      'svelte',
      '@angular/core',
      '@angular/common'
    ]
  },
  {
    entry: {
      'index.umd': 'src/index.ts'
    },
    format: ['iife'],
    globalName: 'DespiaDrawer',
    sourcemap: true,
    splitting: false,
    minify: false,
    clean: false,
    outExtension() {
      return {
        js: '.js'
      };
    }
  }
]);
