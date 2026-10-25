import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// pdf.js'in çalışma anında yüklediği yardımcı dosyalar (wasm çözücüler, standart yazı tipleri, CMap, ICC)
// derlemede dist/renderer/pdfjs altına kopyalanır, geliştirmede /pdfjs adresinden sunulur.
const PDFJS = path.resolve(__dirname, 'node_modules/pdfjs-dist');
const PDFJS_DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];

function pdfjsAssets(): Plugin {
  let outDir = '';
  return {
    name: 'pdfjs-assets',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.join(PDFJS, rel);
        if (!file.startsWith(PDFJS) || !PDFJS_DIRS.includes(rel.split('/')[0]) || !fs.existsSync(file)) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const d of PDFJS_DIRS) fs.cpSync(path.join(PDFJS, d), path.join(outDir, 'pdfjs', d), { recursive: true });
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), pdfjsAssets()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
