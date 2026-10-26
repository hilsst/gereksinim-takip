// Teknik resimleri (PDF, görsel, TIFF, DXF/DWG) Claude için görüntülere çevirir:
// her sayfa için bir genel görünüm + okunabilir çözünürlükte örtüşen bölgeler (bkz. shared/raster.ts).
// Electron'un Chromium sürümü pdf.js'in kullandığı yeni JS özelliklerini henüz içermiyor; legacy derleme çoklu dolgu içerir.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import * as UTIF from 'utif2';
import { gdtLegendSvg } from '../shared/gdtLegend';
import { grid, MAX_EDGE, MAX_IMAGE_BYTES, MAX_IMAGES, MIN_PAGE_EDGE, pickEdge, PX_PER_MM, TEXT_PX, TILE, tileBudget, zone, type DrawingImage } from '../shared/raster';
import { api } from './api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const asset = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
const MAX_PDF_SCALE = 400 / 72; // 400 dpi üzeri gereksiz

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

/** Neredeyse boş (beyaz) bölgeleri atlamak için mürekkep oranı. */
function ink(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let dark = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    n++;
    if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 200) dark++;
  }
  return n ? dark / n : 0;
}

function encode(c: HTMLCanvasElement): Pick<DrawingImage, 'data' | 'mediaType'> {
  let url = c.toDataURL('image/png');
  let mediaType: DrawingImage['mediaType'] = 'image/png';
  if (url.length > 1_500_000) {
    url = c.toDataURL('image/jpeg', 0.88);
    mediaType = 'image/jpeg';
  }
  return { data: url.slice(url.indexOf(',') + 1), mediaType };
}

class Collector {
  images: DrawingImage[] = [];
  text: string[] = [];
  bytes = 0;
  skipped = 0;
  push(label: string, c: HTMLCanvasElement, kind: DrawingImage['kind'], page: number) {
    if (this.images.length >= MAX_IMAGES) return void this.skipped++;
    const e = encode(c);
    if (this.bytes + e.data.length > MAX_IMAGE_BYTES) return void this.skipped++;
    this.bytes += e.data.length;
    this.images.push({ label, ...e, kind, page });
  }
}

/** Büyük kaynak görüntüyü genel görünüm + bölgeler olarak toplar. */
function addPage(out: Collector, src: CanvasImageSource, w: number, h: number, title: string, page: number) {
  const s = Math.min(1, TILE / Math.max(w, h));
  const ov = canvas(w * s, h * s);
  ov.ctx.drawImage(src, 0, 0, ov.c.width, ov.c.height);
  const tiles = grid(w, h);
  out.push(`${title} – ${tiles.length ? 'genel görünüm (küçültülmüş; ayrıntılar bölge görüntülerinde)' : 'tam görüntü'}`, ov.c, tiles.length ? 'overview' : 'tile', page);
  if (!tiles.length) return;
  const rows = Math.max(...tiles.map((t) => t.row)) + 1;
  const cols = Math.max(...tiles.map((t) => t.col)) + 1;
  for (const t of tiles) {
    const tc = canvas(t.w, t.h);
    tc.ctx.drawImage(src, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    if (ink(tc.ctx, t.w, t.h) < 0.00005) continue; // yalnızca tamamen boş bölgeler atlanır
    out.push(`${title} – ${zone(t, rows, cols, w, h)}`, tc.c, 'tile', page);
  }
}

/** PDF'teki gerçek metinleri (CATIA çıktılarında yazılar genelde metin olarak durur) sayfadaki konumlarıyla verir. */
async function pdfText(page: pdfjs.PDFPageProxy, n: number, w: number, h: number): Promise<string[]> {
  const tc = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const items: { s: string; x: number; y: number }[] = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    items.push({ s: it.str.trim(), x: (x / w) * 100, y: (y / h) * 100 });
  }
  // Aynı satırdaki parçalar birleştirilir (yukarıdan aşağıya, soldan sağa)
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { s: string; x: number; y: number; end: number }[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < 0.4 && it.x - last.end < 3) {
      last.s += ` ${it.s}`;
      last.end = it.x + it.s.length * 0.5;
    } else lines.push({ ...it, end: it.x + it.s.length * 0.5 });
  }
  return lines.map((l) => `- Sayfa ${n} (yatay %${Math.round(l.x)}, dikey %${Math.round(l.y)}): ${l.s}`);
}

async function fromPdf(out: Collector, bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes, wasmUrl: asset('wasm'), standardFontDataUrl: asset('standard_fonts'), cMapUrl: asset('cmaps'), iccUrl: asset('iccs') });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_IMAGES);
    const budget = tileBudget(pages);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const long = Math.max(vp1.width, vp1.height);
      const edge = pickEdge(Math.min(vp1.width, vp1.height) / long, budget);
      // PDF sayfa boyutu nokta (1/72 inç) cinsindendir; sayfa kağıt boyutuna göre PX_PER_MM ile işlenir.
      const scale = Math.min(edge / long, MAX_PDF_SCALE, Math.max(MIN_PAGE_EDGE / long, (PX_PER_MM * 25.4) / 72));
      const vp = page.getViewport({ scale });
      const { c, ctx } = canvas(vp.width, vp.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise;
      addPage(out, c, c.width, c.height, `Sayfa ${i}/${doc.numPages}`, i);
      c.width = 0;
      out.text.push(...(await pdfText(page, i, vp1.width, vp1.height)));
      page.cleanup();
    }
    if (doc.numPages > pages) out.skipped += doc.numPages - pages;
  } finally {
    await task.destroy();
  }
}

/** Kaynağı uzun kenarı en çok `edge` olacak şekilde bir tuvale çizer. */
function fit(src: CanvasImageSource, w: number, h: number, edge: number) {
  const s = Math.min(1, edge / Math.max(w, h));
  const { c, ctx } = canvas(w * s, h * s);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function fromImage(out: Collector, bytes: Uint8Array, name: string) {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const edge = pickEdge(Math.min(bmp.width, bmp.height) / Math.max(bmp.width, bmp.height), tileBudget(1));
  const c = fit(bmp, bmp.width, bmp.height, edge);
  bmp.close();
  addPage(out, c, c.width, c.height, `Görsel ${name}`, 1);
}

async function fromTiff(out: Collector, bytes: Uint8Array) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ifds = UTIF.decode(buf).filter((p) => p.t256 && p.t257);
  if (!ifds.length) throw new Error('TIFF dosyasında görüntü bulunamadı.');
  const pages = Math.min(ifds.length, 20);
  for (let i = 0; i < pages; i++) {
    const ifd = ifds[i];
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const { c, ctx } = canvas(ifd.width, ifd.height);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height), 0, 0);
    const edge = pickEdge(Math.min(c.width, c.height) / Math.max(c.width, c.height), tileBudget(pages));
    const f = edge < Math.max(c.width, c.height) ? fit(c, c.width, c.height, edge) : c;
    addPage(out, f, f.width, f.height, `Sayfa ${i + 1}/${ifds.length}`, i + 1);
    c.width = 0;
  }
}

async function fromSvg(out: Collector, svg: string) {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].split(' ').map(Number) ?? [0, 0, 1, 1];
  const [w, h] = [vb[2], vb[3]];
  const long = Math.max(w, h);
  // Ortanca yazı yüksekliği biliniyorsa yazılar ~TEXT_PX piksel olacak kadar büyütülür.
  const textH = Number(/data-text-h="([^"]+)"/.exec(svg)?.[1]);
  const byText = textH > 0 ? Math.max(TILE, (long / textH) * TEXT_PX) : MAX_EDGE;
  const edge = Math.min(pickEdge(Math.min(w, h) / long, tileBudget(1), MAX_EDGE), byText);
  const { c, ctx } = canvas((w / long) * edge, (h / long) * edge);
  // Piksel boyutu SVG'nin kendisine verilir; böylece çizgiler (non-scaling-stroke) ölçekten bağımsız ince kalır.
  const sized = svg.replace(/^<svg ([^>]*?)width="[^"]*" height="[^"]*"/, `<svg $1width="${c.width}" height="${c.height}"`);
  ctx.drawImage(await svgImage(sized), 0, 0, c.width, c.height);
  addPage(out, c, c.width, c.height, 'Çizim (DXF model alanı)', 1);
}

export interface Prepared {
  images: DrawingImage[];
  /** PDF metin katmanı (konumlu satırlar); yoksa boş. */
  pdfText?: string;
  note?: string;
}

async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  await img.decode();
  return img;
}

/** GD&T sembol rehberi görseli (her teknik resim isteğinde Claude'a referans olarak gider). */
async function legend(): Promise<DrawingImage> {
  const img = await svgImage(gdtLegendSvg());
  const { c, ctx } = canvas(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  return { label: 'GD&T sembol rehberi (çizimin parçası değildir; yalnızca sembolleri tanımak için)', ...encode(c), kind: 'legend' };
}

/** Dosyayı okuyup görüntülere çevirir. Hata olursa görüntüsüz devam edilebilmesi için not döner. */
export async function prepareDrawing(filePath: string, name: string): Promise<Prepared> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const out = new Collector();
  if (ext === 'dxf' || ext === 'dwg') {
    const r = await api.cadSvg(filePath);
    if (!r.ok) throw new Error(r.error);
    if (!r.data) return { images: [], note: 'Çizimde görüntülenecek geometri bulunamadı.' };
    await fromSvg(out, r.data);
  } else {
    const bytes = await api.readFile(filePath);
    if (ext === 'pdf') await fromPdf(out, bytes);
    else if (ext === 'tif' || ext === 'tiff') await fromTiff(out, bytes);
    else await fromImage(out, bytes, name);
  }
  if (out.images.length) out.images.unshift(await legend());
  return { images: out.images, pdfText: out.text.join('\n') || undefined, note: out.skipped ? `${out.skipped} görüntü/sayfa boyut sınırı nedeniyle gönderilmedi.` : undefined };
}
