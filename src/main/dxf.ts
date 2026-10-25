// DXF teknik resimlerini okur: yazılar, ölçüler (görünen tolerans metniyle), antet öznitelikleri metne;
// çizgiler, yaylar ve yazılar SVG'ye çevrilir (görüntü olarak Claude'a gönderilmek üzere).
// DWG doğrudan okunamaz; kuruluysa ücretsiz ODA File Converter ile DXF'e çevrilir.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Pair = [number, string];
interface Rec {
  type: string;
  pairs: Pair[];
  children: Rec[]; // POLYLINE köşeleri, INSERT öznitelikleri
}
interface Block {
  name: string;
  base: [number, number];
  ents: Rec[];
}
type M = [number, number, number, number, number, number]; // x' = a x + c y + e, y' = b x + d y + f

export interface DxfText {
  text: string;
  x: number;
  y: number;
  layer: string;
  block?: string;
  tag?: string;
}
export interface DxfDim {
  text: string;
  kind: string;
  measurement?: number;
  layer: string;
  x: number;
  y: number;
}
export interface DxfResult {
  version: string;
  units: string;
  texts: DxfText[];
  attribs: DxfText[];
  dims: DxfDim[];
  svg: string | null;
  primitives: number;
}

const UNITS: Record<string, string> = { '1': 'inç', '2': 'feet', '4': 'mm', '5': 'cm', '6': 'm' };
const DIM_KIND = ['Doğrusal', 'Hizalı', 'Açı', 'Çap', 'Yarıçap', 'Açı (3 nokta)', 'Koordinat'];

function decode(buf: Buffer): string {
  const head = buf.subarray(0, 4000).toString('latin1');
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head)?.[1] ?? '';
  const utf = buf.toString('utf8');
  if (ver >= 'AC1021' || !utf.includes('\uFFFD')) return utf;
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(head)?.[1] ?? '1254';
  try {
    return new TextDecoder(`windows-${cp}`).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

/** MTEXT / TEXT biçim kodlarını temizler; yığılmış toleransları "+0.1/-0.1" biçiminde bırakır. */
export function cleanText(s: string): string {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
    .replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, (_m, a: string, b: string) => ` ${a.trim()}/${b.trim()} `)
    .replace(/\\[fFHWQTACcp][^;\\]*;/g, '')
    .replace(/\\[LlOoKkNX]/g, '')
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function records(src: string): { header: Map<string, string>; blocks: Map<string, Block>; ents: Rec[] } {
  const lines = src.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) throw new Error('DXF dosyası çözümlenemedi (beklenmeyen satır yapısı).');
    pairs.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  const header = new Map<string, string>();
  const blocks = new Map<string, Block>();
  const ents: Rec[] = [];
  let section = '';
  let block: Block | null = null;
  let parent: Rec | null = null;
  let cur: Rec | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      const v = value.trim();
      cur = null;
      if (v === 'SECTION') {
        section = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1].trim() : '';
        continue;
      }
      if (v === 'ENDSEC' || v === 'EOF') {
        section = '';
        continue;
      }
      if (section === 'HEADER') continue;
      if (section !== 'BLOCKS' && section !== 'ENTITIES') continue;
      if (v === 'BLOCK') {
        block = { name: '', base: [0, 0], ents: [] };
        cur = { type: v, pairs: [], children: [] };
        continue;
      }
      if (v === 'ENDBLK') {
        if (block) blocks.set(block.name, block);
        block = null;
        continue;
      }
      if (v === 'SEQEND') {
        parent = null;
        continue;
      }
      const rec: Rec = { type: v, pairs: [], children: [] };
      cur = rec;
      if (parent && (v === 'VERTEX' || v === 'ATTRIB')) {
        parent.children.push(rec);
        continue;
      }
      parent = v === 'POLYLINE' || v === 'INSERT' ? rec : null;
      (section === 'BLOCKS' ? block?.ents : ents)?.push(rec);
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) header.set(value.trim(), pairs[i + 1]?.[1].trim() ?? '');
      continue;
    }
    if (!cur) continue;
    if (cur.type === 'BLOCK' && block) {
      if (code === 2) block.name = value.trim();
      if (code === 10) block.base[0] = Number(value);
      if (code === 20) block.base[1] = Number(value);
      continue;
    }
    cur.pairs.push([code, value]);
  }
  return { header, blocks, ents };
}

const get = (r: Rec, code: number) => r.pairs.find((p) => p[0] === code)?.[1];
const num = (r: Rec, code: number, d = 0) => {
  const v = get(r, code);
  return v === undefined ? d : Number(v);
};
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const ID: M = [1, 0, 0, 1, 0, 0];

function points(r: Rec, xc: number, yc: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [c, v] of r.pairs) {
    if (c === xc) out.push([Number(v), 0]);
    else if (c === yc && out.length) out[out.length - 1][1] = Number(v);
  }
  return out;
}

function mtextRaw(r: Rec) {
  return r.pairs.filter((p) => p[0] === 3).map((p) => p[1]).join('') + (get(r, 1) ?? '');
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

interface Prim {
  d?: string; // yol (dünya koordinatı)
  text?: string;
  x: number;
  y: number;
  h: number;
  rot: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Tam DXF çözümlemesi: metin listesi ve model alanının SVG'si. */
export function parseDxf(buf: Buffer): DxfResult {
  if (buf.subarray(0, 18).toString('latin1') === 'AutoCAD Binary DXF') throw new Error('İkili (binary) DXF desteklenmiyor. Dosyayı ASCII DXF olarak kaydedip tekrar yükleyin.');
  const { header, blocks, ents } = records(decode(buf));
  const texts: DxfText[] = [];
  const attribs: DxfText[] = [];
  const dims: DxfDim[] = [];
  const prims: Prim[] = [];
  const MAX = 300_000;

  const path2 = (m: M, pts: [number, number][], closed: boolean) => {
    if (pts.length < 2 || prims.length > MAX) return;
    const t = pts.map(([x, y]) => apply(m, x, y));
    prims.push({ d: `M${t.map(([x, y]) => `${x} ${y}`).join('L')}${closed ? 'Z' : ''}`, x: t[0][0], y: t[0][1], h: 0, rot: 0, anchor: 'start' });
  };
  const arcPts = (cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number) => {
    if (a1 <= a0) a1 += Math.PI * 2;
    const n = Math.max(8, Math.min(96, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72)));
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = rx * Math.cos(a);
      const y = ry * Math.sin(a);
      out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  };
  const textPrim = (m: M, text: string, x: number, y: number, h: number, rotDeg: number, anchor: Prim['anchor'], sink: DxfText[] | null, meta: Partial<DxfText>, layer: string) => {
    if (!text) return;
    const [wx, wy] = apply(m, x, y);
    const scale = Math.hypot(m[0], m[1]);
    const rot = rotDeg + (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    if (prims.length <= MAX) prims.push({ text, x: wx, y: wy, h: h * scale || 2.5, rot, anchor });
    sink?.push({ text, x: wx, y: wy, layer, ...meta });
  };

  const walk = (list: Rec[], m: M, depth: number, blockName: string | undefined, sink: DxfText[] | null, paperOk: boolean) => {
    for (const r of list) {
      if (!paperOk && get(r, 67) === '1') continue;
      const layer = get(r, 8) ?? '0';
      switch (r.type) {
        case 'LINE':
          path2(m, [[num(r, 10), num(r, 20)], [num(r, 11), num(r, 21)]], false);
          break;
        case 'CIRCLE':
          path2(m, arcPts(num(r, 10), num(r, 20), num(r, 40), num(r, 40), 0, 0, Math.PI * 2), true);
          break;
        case 'ARC':
          path2(m, arcPts(num(r, 10), num(r, 20), num(r, 40), num(r, 40), 0, (num(r, 50) * Math.PI) / 180, (num(r, 51) * Math.PI) / 180), false);
          break;
        case 'ELLIPSE': {
          const mx = num(r, 11);
          const my = num(r, 21);
          const rx = Math.hypot(mx, my);
          path2(m, arcPts(num(r, 10), num(r, 20), rx, rx * num(r, 40, 1), Math.atan2(my, mx), num(r, 41, 0), num(r, 42, Math.PI * 2)), false);
          break;
        }
        case 'LWPOLYLINE':
          path2(m, points(r, 10, 20), (num(r, 70) & 1) === 1);
          break;
        case 'POLYLINE':
          path2(m, r.children.map((v) => [num(v, 10), num(v, 20)] as [number, number]), (num(r, 70) & 1) === 1);
          break;
        case 'SPLINE': {
          const fit = points(r, 11, 21);
          path2(m, fit.length > 1 ? fit : points(r, 10, 20), (num(r, 70) & 1) === 1);
          break;
        }
        case 'SOLID':
        case 'TRACE': {
          const p = [10, 11, 13, 12].map((c) => [num(r, c), num(r, c + 10)] as [number, number]);
          path2(m, p, true);
          break;
        }
        case 'TEXT': {
          const h = num(r, 72);
          const aligned = h !== 0 || num(r, 73) !== 0;
          const x = aligned ? num(r, 11) : num(r, 10);
          const y = aligned ? num(r, 21) : num(r, 20);
          textPrim(m, cleanText(get(r, 1) ?? ''), x, y, num(r, 40, 2.5), num(r, 50), h === 1 || h === 4 ? 'middle' : h === 2 ? 'end' : 'start', sink, { block: blockName }, layer);
          break;
        }
        case 'MTEXT': {
          const att = num(r, 71, 1);
          const dx = get(r, 11) !== undefined ? num(r, 11) : 1;
          const rot = get(r, 50) !== undefined ? num(r, 50) : (Math.atan2(num(r, 21), dx) * 180) / Math.PI;
          textPrim(m, cleanText(mtextRaw(r)), num(r, 10), num(r, 20), num(r, 40, 2.5), rot, (['start', 'middle', 'end'] as const)[(att - 1) % 3], sink, { block: blockName }, layer);
          break;
        }
        case 'INSERT': {
          const b = blocks.get(get(r, 2) ?? '');
          const ins: M = (() => {
            const a = (num(r, 50) * Math.PI) / 180;
            const sx = num(r, 41, 1);
            const sy = num(r, 42, 1);
            const t: M = [Math.cos(a) * sx, Math.sin(a) * sx, -Math.sin(a) * sy, Math.cos(a) * sy, num(r, 10), num(r, 20)];
            return b ? mul(t, [1, 0, 0, 1, -b.base[0], -b.base[1]]) : t;
          })();
          if (b && depth < 6) walk(b.ents, mul(m, ins), depth + 1, b.name.startsWith('*') ? blockName : b.name, sink, true);
          for (const a of r.children) {
            if ((num(a, 70) & 1) === 1) continue;
            textPrim(m, cleanText(get(a, 1) ?? ''), num(a, 10), num(a, 20), num(a, 40, 2.5), num(a, 50), 'start', attribs, { tag: get(a, 2), block: b?.name }, get(a, 8) ?? layer);
          }
          break;
        }
        case 'DIMENSION': {
          const type = num(r, 70) & 7;
          const meas = get(r, 42) !== undefined ? num(r, 42) : undefined;
          const b = blocks.get(get(r, 2) ?? '');
          const shown: DxfText[] = [];
          if (b && depth < 6) walk(b.ents, m, depth + 1, undefined, shown, true);
          let text = shown.map((t) => t.text).join(' ').trim();
          if (!text) {
            const value = meas === undefined ? '' : (type === 3 ? 'Ø' : type === 4 ? 'R' : '') + fmt(meas) + (type === 2 || type === 5 ? '°' : '');
            const over = cleanText(get(r, 1) ?? '');
            text = over ? over.replace('<>', value) : value;
            if (prims.length <= MAX && text) {
              const [x, y] = [num(r, 11), num(r, 21)];
              textPrim(m, text, x, y, 2.5, 0, 'middle', null, {}, layer);
            }
          }
          const [x, y] = apply(m, num(r, 11), num(r, 21));
          if (text) dims.push({ text, kind: DIM_KIND[type] ?? 'Ölçü', measurement: meas, layer, x, y });
          break;
        }
        default:
          break;
      }
    }
  };

  walk(ents, ID, 0, undefined, texts, false);
  // Kağıt alanındaki (layout) antet ve notlar da metin olarak alınır; görüntüye model alanı çizilir.
  const modelPrims = prims.length;
  const paper = ents.filter((r) => get(r, 67) === '1');
  if (paper.length) walk(paper, ID, 0, '(kağıt alanı)', texts, true);
  prims.length = modelPrims;

  return {
    version: header.get('$ACADVER') ?? '',
    units: UNITS[header.get('$INSUNITS') ?? ''] ?? '',
    texts,
    attribs,
    dims,
    svg: toSvg(prims),
    primitives: prims.length,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toSvg(prims: Prim[]): string | null {
  if (!prims.length) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of prims) {
    if (p.d) {
      for (const m of p.d.matchAll(/(-?[\d.e+-]+) (-?[\d.e+-]+)/g)) {
        xs.push(Number(m[1]));
        ys.push(Number(m[2]));
      }
    } else {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const finite = (a: number[]) => a.filter(Number.isFinite).sort((p, q) => p - q);
  const sx = finite(xs);
  const sy = finite(ys);
  if (!sx.length) return null;
  // Uzak tek tük nesneler (çizim dışı kalıntılar) görüntüyü küçültmesin: %0.2–%99.8 aralığı
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * f)))];
  const [x0, x1, y0, y1] = [q(sx, 0.002), q(sx, 0.998), q(sy, 0.002), q(sy, 0.998)];
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const pad = Math.max(w, h) * 0.02;
  const vb = [x0 - pad, -(y1 + pad), w + 2 * pad, h + 2 * pad].map((n) => +n.toFixed(4));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">`);
  out.push(`<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>`);
  out.push('<g transform="scale(1,-1)" fill="none" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round">');
  for (const p of prims) if (p.d) out.push(`<path d="${p.d}" vector-effect="non-scaling-stroke"/>`);
  out.push('</g><g font-family="Arial, Helvetica, sans-serif" fill="#000">');
  for (const p of prims) {
    if (!p.text) continue;
    const lines = p.text.split('\n');
    const x = +p.x.toFixed(4);
    const y = +(-p.y).toFixed(4);
    const tr = p.rot ? ` transform="rotate(${+(-p.rot).toFixed(2)} ${x} ${y})"` : '';
    const spans = lines.map((l, i) => `<tspan x="${x}" dy="${i ? +(p.h * 1.4).toFixed(4) : 0}">${esc(l)}</tspan>`).join('');
    out.push(`<text x="${x}" y="${y}" font-size="${+p.h.toFixed(4)}" text-anchor="${p.anchor}"${tr}>${spans}</text>`);
  }
  out.push('</g></svg>');
  return out.join('');
}

/** Claude'a gönderilecek metin özeti. */
export function dxfSummary(name: string, d: DxfResult): string {
  const out: string[] = [`DXF teknik resim: ${name}${d.version ? ` (AutoCAD ${d.version})` : ''}${d.units ? `, çizim birimi ${d.units}` : ''}`];
  const uniq = <T,>(arr: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    return arr.filter((t) => {
      const k = key(t);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const byPos = <T extends { x: number; y: number }>(a: T[]) => [...a].sort((p, q) => q.y - p.y || p.x - q.x);
  const at = (t: { x: number; y: number }) => `(${fmt(+t.x.toFixed(1))}, ${fmt(+t.y.toFixed(1))})`;
  if (d.attribs.length) {
    out.push('', '## Antet ve blok öznitelikleri');
    for (const a of uniq(d.attribs, (t) => `${t.tag}|${t.text}`)) out.push(`- ${a.tag ?? ''}: ${a.text}${a.block ? ` [blok ${a.block}]` : ''}`);
  }
  if (d.dims.length) {
    out.push('', `## Ölçüler (${d.dims.length}) – görünen metin, tolerans dahil`);
    for (const m of byPos(d.dims).slice(0, 3000)) out.push(`- ${m.kind}: ${m.text}${m.measurement !== undefined ? ` (gerçek ölçü ${fmt(m.measurement)})` : ''} · konum ${at(m)} · katman ${m.layer}`);
  }
  const texts = uniq(byPos(d.texts), (t) => `${t.text}|${Math.round(t.x)}|${Math.round(t.y)}`);
  if (texts.length) {
    out.push('', `## Yazılar ve notlar (${texts.length}) – yukarıdan aşağıya`);
    for (const t of texts.slice(0, 4000)) out.push(`- ${at(t)} ${t.text.replace(/\n/g, ' / ')}${t.block ? ` [blok ${t.block}]` : ''} · katman ${t.layer}`);
  }
  if (!d.attribs.length && !d.dims.length && !texts.length) out.push('', '(Dosyada okunabilir yazı veya ölçü bulunamadı.)');
  return out.join('\n');
}

const run = (file: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(file, args, { timeout: 180_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });

/** ODA File Converter'ı bilinen kurulum yerlerinde arar. */
export async function findOda(custom?: string): Promise<string | null> {
  const candidates: string[] = [];
  if (custom) candidates.push(custom);
  if (process.env.ODA_FILE_CONVERTER) candidates.push(process.env.ODA_FILE_CONVERTER);
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']) {
      if (!root) continue;
      const dir = path.join(root, 'ODA');
      const subs = await fs.readdir(dir).catch(() => [] as string[]);
      for (const s of subs.filter((x) => /^ODAFileConverter/i.test(x)).sort().reverse()) candidates.push(path.join(dir, s, 'ODAFileConverter.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter');
  } else {
    candidates.push('/usr/bin/ODAFileConverter', '/usr/local/bin/ODAFileConverter');
  }
  for (const c of candidates) {
    if (await fs.access(c).then(() => true, () => false)) return c;
  }
  return null;
}

export const ODA_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

/** DWG'yi DXF'e çevirir (ODA File Converter gerekir). */
export async function dwgToDxf(buf: Buffer, name: string): Promise<Buffer> {
  const oda = await findOda();
  if (!oda) {
    throw new Error(`${name}: DWG dosyaları doğrudan okunamıyor. Ücretsiz "ODA File Converter" programını kurun (${ODA_URL}); uygulama onu bulup DWG'yi otomatik çevirir. Alternatif: çizimi CATIA / AutoCAD'den DXF veya PDF olarak kaydedip yükleyin.`);
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gt-dwg-'));
  try {
    const inDir = path.join(tmp, 'in');
    const outDir = path.join(tmp, 'out');
    await fs.mkdir(inDir);
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(inDir, 'cizim.dwg'), buf);
    await run(oda, [inDir, outDir, 'ACAD2018', 'DXF', '0', '0', '*.DWG']);
    const out = (await fs.readdir(outDir)).find((f) => f.toLowerCase().endsWith('.dxf'));
    if (!out) throw new Error(`${name}: ODA File Converter DXF üretmedi. Dosya bozuk ya da desteklenmeyen bir DWG sürümü olabilir.`);
    return await fs.readFile(path.join(outDir, out));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Aynı dosya önce görüntü (SVG) sonra metin için okunur; DWG dönüşümü tekrarlanmasın.
const cache = new Map<string, DxfResult>();

/** DXF veya DWG dosyasını çözümler (DWG önce DXF'e çevrilir). */
export async function readCad(buf: Buffer, name: string): Promise<DxfResult> {
  const key = createHash('sha1').update(buf).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const dxf = path.extname(name).toLowerCase() === '.dwg' ? await dwgToDxf(buf, name) : buf;
  const r = parseDxf(dxf);
  cache.set(key, r);
  if (cache.size > 3) cache.delete(cache.keys().next().value!);
  return r;
}
