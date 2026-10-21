import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5341, host: 'localhost' },
  preview: { port: 5341, host: 'localhost' },
  build: { target: 'es2022' },
});
