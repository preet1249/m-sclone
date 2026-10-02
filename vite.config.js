import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The cloned pages include the site's own original JavaScript, some of which
// (e.g. public/pages/022-events/script.js) does a HEAD request to check
// whether a specific image variant exists before using it, falling back to
// the original URL on a 404. Vite's default SPA fallback serves index.html
// (200 OK) for ANY unmatched path, which makes that existence check always
// "succeed" and break images that depend on it. This plugin makes requests
// for static-asset-looking paths (anything under a public asset directory
// with a file extension) that don't exist return a real 404 instead, same as
// a production static file host would.
function realNotFoundForMissingAssets() {
  return {
    name: 'real-404-for-missing-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = req.url.split('?')[0]
        if (/^\/(wp-content|skynet-assets|webfonts|fonts|pages)\/.*\.[a-zA-Z0-9]+$/.test(urlPath)) {
          const filePath = path.join(server.config.publicDir, decodeURIComponent(urlPath))
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), realNotFoundForMissingAssets()],
})
