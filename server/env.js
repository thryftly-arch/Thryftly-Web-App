// Imported first by server/index.js so .env is loaded before store.js and integrations.js read it.
try { process.loadEnvFile(); } catch { /* no .env: rely on real env vars (Netlify, Docker) */ }
