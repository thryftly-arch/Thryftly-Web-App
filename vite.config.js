import { resolve } from 'path';

export default {
  server: { proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' } },
  build: {
    target: 'es2022', // top-level await in the page scripts
    rollupOptions: {
      input: Object.fromEntries(['index', 'product', 'checkout', 'admin', 'shop', 'about', 'contact', 'policy', 'track'].map(n => [n, resolve(`${n}.html`)])),
    },
  },
};
