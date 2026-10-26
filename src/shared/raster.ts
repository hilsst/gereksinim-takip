// Teknik resimlerin Claude'a gönderilmeden önce bölgelere ayrılma planı.
// Claude görüntüleri uzun kenarı ~1568 piksele küçültür; A3–A0 bir resimde ölçü yazıları bu boyutta okunamaz.
// Bu yüzden her sayfa bir genel görünüm + örtüşen yüksek çözünürlüklü bölgeler olarak gönderilir.

export const TILE = 1568;
// Örtüşme, bölge kenarına denk gelen tolerans çerçevesinin en az bir bölgede bütün görünmesi için geniş tutulur.
export const OVERLAP = 0.25;
export const MAX_EDGE = 6400; // bir sayfanın işleneceği en büyük uzun kenar (piksel)
// Hedef çözünürlük: 3.5 mm'lik yazı ~35 piksel. Daha yükseği okumayı iyileştirmez, yalnızca bölge sayısını
// artırır ve tolerans çerçevelerinin bölge kenarında kesilme olasılığını yükseltir.
export const PX_PER_MM = 10;
export const TEXT_PX = 35;
export const MAX_IMAGES = 80; // istek başına görüntü sınırı (API sınırı 100)
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024; // görüntülerin base64 toplamı

export const RASTER_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'dxf', 'dwg'];

/** Bu doküman görüntü olarak hazırlanmalı mı? Görseller ve CAD her zaman; PDF yalnızca teknik resimse. */
export function needsRaster(ext: string, docType: string) {
  if (!RASTER_EXT.includes(ext)) return false;
  return ext !== 'pdf' || docType === 'Teknik resim';
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

export interface DrawingImage {
  label: string;
  data: string; // base64
  mediaType: 'image/png' | 'image/jpeg';
  kind?: 'overview' | 'tile' | 'legend';
  page?: number;
}

function axis(len: number, tile: number, overlap: number): [number, number][] {
  if (len <= tile) return [[0, len]];
  const ov = Math.round(tile * overlap);
  const n = Math.ceil((len - ov) / (tile - ov));
  const step = (len - tile) / (n - 1);
  return Array.from({ length: n }, (_v, i) => [Math.round(i * step), tile]);
}

/** w×h piksellik görüntüyü TILE boyutunda, %25 örtüşen bölgelere ayırır. Görüntü zaten küçükse boş döner. */
export function grid(w: number, h: number, tile = TILE, overlap = OVERLAP): Tile[] {
  if (w <= tile && h <= tile) return [];
  const xs = axis(w, tile, overlap);
  const ys = axis(h, tile, overlap);
  const out: Tile[] = [];
  ys.forEach(([y, th], row) => xs.forEach(([x, tw], col) => out.push({ x, y, w: Math.min(tw, w), h: Math.min(th, h), row, col })));
  return out;
}

/**
 * Sayfanın işleneceği uzun kenarı seçer: en çok MAX_EDGE, bölge sayısı bütçeyi aşmayacak kadar.
 * aspect = kısa kenar / uzun kenar.
 */
export function pickEdge(aspect: number, budget: number, maxEdge = MAX_EDGE): number {
  if (budget < 1) return TILE;
  let edge = maxEdge;
  while (edge > TILE && grid(edge, Math.round(edge * aspect)).length > budget) edge = Math.floor(edge * 0.9);
  return Math.max(edge, TILE);
}

/** Sayfa başına bölge bütçesi (genel görünüm hariç). */
export function tileBudget(pages: number): number {
  return Math.max(0, Math.floor(MAX_IMAGES / Math.max(1, pages)) - 1);
}

/** Bölge adı: satır harfi + sütun numarası (A1 sol üst), teknik resim pafta düzenine benzer. */
export function zone(t: Tile, rows: number, cols: number, w: number, h: number): string {
  const x0 = Math.round((t.x / w) * 100);
  const x1 = Math.round(((t.x + t.w) / w) * 100);
  const y0 = Math.round((t.y / h) * 100);
  const y1 = Math.round(((t.y + t.h) / h) * 100);
  return `bölge ${String.fromCharCode(65 + t.row)}${t.col + 1} (satır ${t.row + 1}/${rows}, sütun ${t.col + 1}/${cols}; yatay %${x0}–${x1}, dikey %${y0}–${y1})`;
}
