import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..')

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ')

// Pages in `public/<name>.html` that should also be reachable at `/<name>`
// (no extension). Cloudflare Pages does this strip automatically in prod;
// `vite dev` and `vite preview` don't, so this plugin replicates the
// behavior locally and keeps the in-app links working in both modes.
const CLEAN_URL_PAGES = ['about']

function devCleanUrls(): PluginOption {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url
    for (const page of CLEAN_URL_PAGES) {
      if (url === `/${page}` || url.startsWith(`/${page}?`)) {
        return url.replace(`/${page}`, `/${page}.html`)
      }
    }
    return url
  }
  return {
    name: 'dev-clean-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        req.url = rewrite(req.url)
        next()
      })
    },
  }
}

// Inject the production CSP via <meta> only in the built bundle.
// In `vite dev` the CSP would block the HMR WebSocket; in the static
// production build the runtime never speaks to anything off-origin.
function injectProdCspMeta(): PluginOption {
  return {
    name: 'inject-prod-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
          {
            tag: 'meta',
            attrs: { name: 'referrer', content: 'no-referrer' },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), devCleanUrls(), injectProdCspMeta()],
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  assetsInclude: ['**/*.yaml'],
  build: {
    // No source maps in production: they expose original source on a
    // public deployment and bloat the build with no end-user benefit.
    sourcemap: false,
    // No modulepreload polyfill: it's the only thing in the bundle that
    // calls fetch(). We're a single-chunk SPA on modern browsers; the
    // polyfill is dead code in practice. Removing it makes the privacy
    // claim ("no network egress") provable by grep.
    modulePreload: { polyfill: false },
  },
})
