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
  /** Yazının ortası (dünya koordinatı), yüksekliği ve açısı: çerçeve tespiti için. */
  cx?: number;
  cy?: number;
  h?: number;
  rot?: number;
  /** Tolerans çerçevesi satırına veya referans işaretine dahil edildi. */
  grouped?: boolean;
}
export interface DxfDim {
  text: string;
  kind: string;
  measurement?: number;
  layer: string;
  x: number;
  y: number;
  /** Ölçü yazısı bir kutu içinde: ISO 1101 teorik tam ölçü (TED). */
  basic?: boolean;
}
/** Eksene paralel çizgi parçası: yatayda a = y, [b, c] = x aralığı; dikeyde a = x, [b, c] = y aralığı. */
interface Seg {
  a: number;
  b: number;
  c: number;
}
export interface DxfResult {
  version: string;
  units: string;
  texts: DxfText[];
  attribs: DxfText[];
  dims: DxfDim[];
  gdt: DxfText[];
  /** Kutu içindeki yazılardan tespit edilen tolerans çerçevesi satırları ve referans (datum) işaretleri. */
  frames: FrameRow[];
  datums: DxfText[];
  svg: string | null;
  primitives: number;
}
export interface FrameRow {
  cells: string[];
  /** Solunda yazısız hücre var: sembol çizgiyle çizilmiş (görüntüden okunur). */
  symbolCell: boolean;
  x: number;
  y: number;
  /** Üst üste yığılmış çok satırlı çerçevenin ve üstündeki yazının (ör. "4X Ø8.5") ortak etiketi. */
  label?: string;
  stack?: number;
}

const UNITS: Record<string, string> = { '1': 'inç', '2': 'feet', '4': 'mm', '5': 'cm', '6': 'm' };
// AutoCAD TOLERANCE nesnesinde semboller GDT yazı tipinin harfleriyle yazılır.
const GDT_FONT: Record<string, string> = {
  a: 'Açısallık', b: 'Diklik', c: 'Düzlemsellik', d: 'Yüzey profili', e: 'Dairesellik', f: 'Paralellik', g: 'Silindiriklik',
  h: 'Dairesel salgı', i: 'Simetri', j: 'Konum', k: 'Çizgi profili', r: 'Eş merkezlilik', t: 'Toplam salgı', u: 'Doğrusallık',
  n: 'Ø', m: '(M)', l: '(L)', s: '(S)', p: '(P)', q: 'CL', o: '□',
};

/** TOLERANCE nesnesinin metnini okunur biçime çevirir: "Konum | Ø0.2 (M) | A | B | C". */
export function gdtText(raw: string): string {
  return cleanText(
    raw
      .replace(/\{\\F[Gg][Dd][Tt];([^}]*)\}/g, (_m, c: string) => [...c].map((ch) => GDT_FONT[ch.toLowerCase()] ?? ch).join(''))
      .replace(/\^J/g, '\\P')
      .replace(/%%v/gi, ' | '),
  )
    .replace(/(Açısallık|Diklik|Düzlemsellik|Yüzey profili|Dairesellik|Paralellik|Silindiriklik|Dairesel salgı|Simetri|Konum|Çizgi profili|Eş merkezlilik|Toplam salgı|Doğrusallık)(?=\S)/g, '$1 ')
    .replace(/(\S)\((M|L|S|P)\)/g, '$1 ($2)')
    .replace(/(\s*\|)+[ \t]*$/gm, '')
    .replace(/\|[ \t]*\|/g, '|')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

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

function records(src: string): { header: Map<string, string>; blocks: Map<string, Block>; ents: Rec[]; layers: Map<string, string> } {
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
  const layerRecs: Rec[] = [];
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
      if (section === 'TABLES') {
        // Katmanların çizgi tipi (gizli / eksen çizgisi) için yalnızca LAYER kayıtları
        if (v === 'LAYER') layerRecs.push((cur = { type: v, pairs: [], children: [] }));
        continue;
      }
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
  const layers = new Map<string, string>();
  for (const r of layerRecs) layers.set(get(r, 2) ?? '', (get(r, 6) ?? '').toUpperCase());
  return { header, blocks, ents, layers };
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
  dash?: 'hidden' | 'center';
  fill?: boolean;
  valign?: 'base' | 'bottom' | 'middle' | 'top';
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
  const { header, blocks, ents, layers } = records(decode(buf));
  const texts: DxfText[] = [];
  const attribs: DxfText[] = [];
  const dims: DxfDim[] = [];
  const gdt: DxfText[] = [];
  const dimText = new Map<number, DxfText>();
  const prims: Prim[] = [];
  const hs: Seg[] = [];
  const vs: Seg[] = [];
  const MAX = 300_000;

  // Çizgi tipi: nesnenin kendisi, BYLAYER ise katmanınki. Gizli ve eksen çizgileri kesikli çizilir.
  const dashOf = (r: Rec): Prim['dash'] => {
    let lt = (get(r, 6) ?? 'BYLAYER').toUpperCase();
    if (lt === 'BYLAYER' || lt === 'BYBLOCK') lt = layers.get(get(r, 8) ?? '0') ?? '';
    if (/HIDDEN|DASHED|GIZLI|VERDECK|^DASH/.test(lt)) return 'hidden';
    if (/CENTER|CHAIN|DASHDOT|PHANTOM|EKSEN|DIVIDE/.test(lt)) return 'center';
    return undefined;
  };
  let style: Pick<Prim, 'dash' | 'fill'> = {};
  const path2 = (m: M, pts: [number, number][], closed: boolean) => {
    if (pts.length < 2 || prims.length > MAX) return;
    const t = pts.map(([x, y]) => apply(m, x, y));
    const ring = closed ? [...t, t[0]] : t;
    for (let i = 1; i < ring.length; i++) {
      const [[x0, y0], [x1, y1]] = [ring[i - 1], ring[i]];
      const eps = 1e-6 * (1 + Math.abs(x0) + Math.abs(y0));
      if (Math.abs(y1 - y0) <= eps && Math.abs(x1 - x0) > eps) hs.push({ a: y0, b: Math.min(x0, x1), c: Math.max(x0, x1) });
      else if (Math.abs(x1 - x0) <= eps && Math.abs(y1 - y0) > eps) vs.push({ a: x0, b: Math.min(y0, y1), c: Math.max(y0, y1) });
    }
    prims.push({ d: `M${t.map(([x, y]) => `${x} ${y}`).join('L')}${closed ? 'Z' : ''}`, x: t[0][0], y: t[0][1], h: 0, rot: 0, anchor: 'start', ...style });
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
  // valign: yazı noktasının dikeyde yeri (taban çizgisi, alt, orta, üst)
  const textPrim = (m: M, text: string, x: number, y: number, h: number, rotDeg: number, anchor: Prim['anchor'], sink: DxfText[] | null, meta: Partial<DxfText>, layer: string, valign: 'base' | 'bottom' | 'middle' | 'top' = 'base') => {
    if (!text) return;
    const [wx, wy] = apply(m, x, y);
    const scale = Math.hypot(m[0], m[1]);
    const rot = rotDeg + (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const hh = h * scale || 2.5;
    if (prims.length <= MAX) prims.push({ text, x: wx, y: wy, h: hh, rot, anchor, valign });
    if (!sink) return;
    // Yazının ortası: genişlik karakter sayısından yaklaşık hesaplanır.
    const w2 = textHalfWidth(text, hh);
    const dx = anchor === 'start' ? w2 : anchor === 'end' ? -w2 : 0;
    const dy = valign === 'middle' ? 0 : valign === 'top' ? -hh / 2 : hh / 2;
    const r = (rot * Math.PI) / 180;
    sink.push({ text, x: wx, y: wy, layer, cx: wx + dx * Math.cos(r) - dy * Math.sin(r), cy: wy + dx * Math.sin(r) + dy * Math.cos(r), h: hh, rot, ...meta });
  };

  const walk = (list: Rec[], m: M, depth: number, blockName: string | undefined, sink: DxfText[] | null, paperOk: boolean) => {
    for (const r of list) {
      if (!paperOk && get(r, 67) === '1') continue;
      const layer = get(r, 8) ?? '0';
      style = { dash: dashOf(r), fill: r.type === 'SOLID' || r.type === 'TRACE' };
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
          const v = num(r, 73);
          textPrim(m, cleanText(get(r, 1) ?? ''), x, y, num(r, 40, 2.5), num(r, 50), h === 1 || h === 4 ? 'middle' : h === 2 ? 'end' : 'start', sink, { block: blockName }, layer, h === 4 || v === 2 ? 'middle' : v === 3 ? 'top' : v === 1 ? 'bottom' : 'base');
          break;
        }
        case 'MTEXT': {
          const att = num(r, 71, 1);
          const dx = get(r, 11) !== undefined ? num(r, 11) : 1;
          const rot = get(r, 50) !== undefined ? num(r, 50) : (Math.atan2(num(r, 21), dx) * 180) / Math.PI;
          textPrim(m, cleanText(mtextRaw(r)), num(r, 10), num(r, 20), num(r, 40, 2.5), rot, (['start', 'middle', 'end'] as const)[(att - 1) % 3], sink, { block: blockName }, layer, att <= 3 ? 'top' : att <= 6 ? 'middle' : 'bottom');
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
        case 'TOLERANCE': {
          const text = gdtText(get(r, 1) ?? '');
          const dx = num(r, 11, 1);
          textPrim(m, text, num(r, 10), num(r, 20), num(r, 40, 2.5) || 2.5, (Math.atan2(num(r, 21), dx) * 180) / Math.PI, 'start', gdt, { block: blockName }, layer);
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
          // Kutu tespiti için yazı yüksekliği ve açısı bloktaki yazıdan alınır.
          if (text) dimText.set(dims.length, { text, x, y, layer, cx: x, cy: y, h: shown[0]?.h ?? 2.5, rot: shown[0]?.rot ?? 0 });
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

  // Kutu içindeki yazılar: TED ölçüleri, çizgiyle çizilmiş tolerans çerçeveleri ve referans işaretleri
  const boxes = boxFinder(hs, vs);
  for (const [i, t] of dimText) if (boxes.boxed(t)) dims[i].basic = true;
  const { frames, datums } = frameRows(texts, boxes);

  return {
    version: header.get('$ACADVER') ?? '',
    units: UNITS[header.get('$INSUNITS') ?? ''] ?? '',
    texts,
    attribs,
    dims,
    gdt,
    frames,
    datums,
    svg: toSvg(prims),
    primitives: prims.length,
  };
}

function textHalfWidth(text: string, h: number) {
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  return (longest * h * 0.62) / 2;
}

interface Boxes {
  /** Yazının dört yanında da yakın bir çizgi var mı (kutu / çerçeve hücresi içinde mi)? */
  boxed(t: DxfText): boolean;
  /** Yazının solundaki hücre sınırları (yakından uzağa x değerleri). */
  leftEdges(t: DxfText): number[];
}

function boxFinder(hs: Seg[], vs: Seg[]): Boxes {
  const H = [...hs].sort((p, q) => p.a - q.a);
  const V = [...vs].sort((p, q) => p.a - q.a);
  const lower = (arr: Seg[], v: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].a < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // [a0, a1] aralığında olup [b0, b1]'i kapsayan parçalar
  const find = (arr: Seg[], a0: number, a1: number, b0: number, b1: number) => {
    const out: number[] = [];
    for (let i = lower(arr, a0); i < arr.length && arr[i].a <= a1; i++) if (arr[i].b <= b0 && arr[i].c >= b1) out.push(arr[i].a);
    return out;
  };
  // Yazı ekseninde: u = yazı yönü, v = yazıya dik. 90° döndürülmüş yazıda yataylar ile dikeyler yer değiştirir.
  const frame = (t: DxfText) => {
    const h = t.h ?? 2.5;
    const w2 = textHalfWidth(t.text, h);
    const vertical = Math.abs(Math.sin(((t.rot ?? 0) * Math.PI) / 180)) > 0.7;
    const cx = t.cx ?? t.x;
    const cy = t.cy ?? t.y;
    return vertical
      ? { across: V, along: H, cu: cy, cv: cx, w2, h }
      : { across: H, along: V, cu: cx, cv: cy, w2, h };
  };
  return {
    boxed(t) {
      const { across, along, cu, cv, w2, h } = frame(t);
      const span = Math.min(w2 * 0.5, h);
      const above = find(across, cv + h * 0.4, cv + h * 1.6, cu - span, cu + span).length > 0;
      const below = find(across, cv - h * 1.6, cv - h * 0.4, cu - span, cu + span).length > 0;
      const left = find(along, cu - w2 - h * 2, cu - w2 * 0.6, cv - h * 0.3, cv + h * 0.3).length > 0;
      const right = find(along, cu + w2 * 0.6, cu + w2 + h * 4, cv - h * 0.3, cv + h * 0.3).length > 0;
      return above && below && left && right;
    },
    leftEdges(t) {
      const { along, cu, cv, w2, h } = frame(t);
      const xs = find(along, cu - w2 - h * 6, cu - w2 * 0.6, cv - h * 0.3, cv + h * 0.3).sort((p, q) => q - p);
      return xs.filter((x, i) => i === 0 || xs[i - 1] - x > h * 0.3);
    },
  };
}

/** Kutu içindeki yazıları satırlara toplar: çok hücreli satır = tolerans çerçevesi, tek harfli kutu = referans işareti. */
function frameRows(texts: DxfText[], boxes: Boxes): { frames: FrameRow[]; datums: DxfText[] } {
  const cx = (t: DxfText) => t.cx ?? t.x;
  const cy = (t: DxfText) => t.cy ?? t.y;
  const th = (t: DxfText) => t.h ?? 2.5;
  const flat = texts.filter((t) => t.cx !== undefined && !t.text.includes('\n') && t.text.length <= 24 && Math.abs(Math.sin(((t.rot ?? 0) * Math.PI) / 180)) < 0.2);
  const boxed = flat.filter((t) => boxes.boxed(t)).sort((p, q) => cx(p) - cx(q));
  const used = new Set<DxfText>();
  interface Row extends FrameRow {
    left: number;
    right: number;
    h: number;
  }
  const rows: Row[] = [];
  const datums: DxfText[] = [];
  for (const t of boxed) {
    if (used.has(t)) continue;
    // Aynı hizadaki bitişik kutulu yazılar bir satırdır.
    const row = [t];
    used.add(t);
    for (const u of boxed) {
      if (used.has(u)) continue;
      const last = row[row.length - 1];
      const h = Math.max(th(last), th(u));
      const gap = cx(u) - textHalfWidth(u.text, th(u)) - (cx(last) + textHalfWidth(last.text, th(last)));
      if (Math.abs(cy(u) - cy(t)) <= h * 0.6 && gap > -h && gap <= h * 4) {
        row.push(u);
        used.add(u);
      }
    }
    const edges = boxes.leftEdges(t);
    // Sembol hücresi: ilk kutunun hemen solunda, yaklaşık kare, yazısız bir hücre.
    // (Sembolün kendi dikey çizgileri de bulunabilir; bu yüzden en az bir kenarın uygun uzaklıkta olması yeterli.)
    const symbolCell = edges.slice(1).some((e) => edges[0] - e >= th(t) * 1.5 && edges[0] - e <= th(t) * 3.5);
    if (row.length === 1 && !symbolCell && /^[A-Z]{1,2}\d?$/.test(t.text)) {
      t.grouped = true;
      datums.push(t);
      continue;
    }
    // Tablo / antet hücreleri çerçeve sayılmaz: ilk hücre tolerans değeri, diğerleri referans harfleri olmalı.
    if (!/^[ØR]?\d*[.,]?\d+$/.test(t.text) || !row.slice(1).every((u) => /^[A-Z]{1,2}\d?$|^[A-Z]-[A-Z]$/.test(u.text)) || (row.length === 1 && !symbolCell)) {
      for (const u of row.slice(1)) used.delete(u);
      continue;
    }
    // Hücre içindeki kutusuz küçük yazılar (ör. daire içindeki M) önündeki hücreye katılır.
    const x0 = cx(row[0]);
    const x1 = cx(row[row.length - 1]);
    const extra = flat.filter((u) => !used.has(u) && !boxed.includes(u) && cx(u) > x0 && cx(u) < x1 && Math.abs(cy(u) - cy(t)) <= th(t) * 0.6);
    const cells: string[] = [];
    for (const c of [...row, ...extra].sort((p, q) => cx(p) - cx(q))) {
      c.grouped = true;
      if (extra.includes(c) && cells.length) cells[cells.length - 1] += ` ${c.text}`;
      else cells.push(c.text);
    }
    rows.push({ cells, symbolCell, x: t.x, y: cy(t), left: edges[0] ?? x0, right: x1, h: th(t) });
  }
  // Üst üste yığılmış satırlar (aynı sol kenar, satır yüksekliği kadar aralık) tek çerçevedir; üstündeki kutusuz yazı etiketidir.
  rows.sort((p, q) => q.y - p.y);
  let stack = 0;
  for (const top of rows) {
    if (top.stack) continue;
    top.stack = ++stack;
    let cur = top;
    for (const f of rows) {
      if (f.stack || Math.abs(f.left - top.left) > top.h * 0.5) continue;
      if (cur.y - f.y > 0 && cur.y - f.y <= top.h * 3) {
        f.stack = stack;
        cur = f;
      }
    }
    const label = texts
      .filter((t) => !t.grouped && t.cx !== undefined && cy(t) - top.y > top.h * 0.6 && cy(t) - top.y <= top.h * 3.5)
      .filter((t) => cx(t) + textHalfWidth(t.text, th(t)) > top.left && cx(t) - textHalfWidth(t.text, th(t)) < top.right)
      .sort((p, q) => cy(p) - cy(q))[0];
    if (label) for (const f of rows) if (f.stack === stack) f.label = label.text;
  }
  return { frames: rows.map(({ left: _l, right: _r, h: _h, ...f }) => f), datums };
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
  const hs = prims.filter((p) => p.text).map((p) => p.h).sort((p, q) => p - q);
  const textH = hs.length ? ` data-text-h="${+hs[Math.floor(hs.length / 2)].toFixed(4)}"` : '';
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}"${textH}>`);
  out.push(`<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fff"/>`);
  out.push('<g transform="scale(1,-1)" fill="none" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round">');
  // Kesikli çizgi aralıkları yazı yüksekliğine göre (çizim birimi cinsinden)
  const unit = hs.length ? hs[Math.floor(hs.length / 2)] : Math.max(w, h) / 200;
  const dashes = { hidden: `${+(unit * 1.2).toFixed(4)} ${+(unit * 0.6).toFixed(4)}`, center: `${+(unit * 3).toFixed(4)} ${+(unit * 0.6).toFixed(4)} ${+(unit * 0.4).toFixed(4)} ${+(unit * 0.6).toFixed(4)}` };
  for (const p of prims) {
    if (!p.d) continue;
    const attrs = `${p.fill ? ' fill="#000"' : ''}${p.dash ? ` stroke-dasharray="${dashes[p.dash]}"` : ''}`;
    out.push(`<path d="${p.d}" vector-effect="non-scaling-stroke"${attrs}/>`);
  }
  out.push('</g><g font-family="Arial, Helvetica, sans-serif" fill="#000">');
  for (const p of prims) {
    if (!p.text) continue;
    const lines = p.text.split('\n');
    const x = +p.x.toFixed(4);
    const y = +(-p.y).toFixed(4);
    const tr = p.rot ? ` transform="rotate(${+(-p.rot).toFixed(2)} ${x} ${y})"` : '';
    const spans = lines.map((l, i) => `<tspan x="${x}" dy="${i ? +(p.h * 1.4).toFixed(4) : 0}">${esc(l)}</tspan>`).join('');
    const base = p.valign === 'middle' ? ' dominant-baseline="central"' : p.valign === 'top' ? ' dominant-baseline="hanging"' : p.valign === 'bottom' ? ' dominant-baseline="text-after-edge"' : '';
    out.push(`<text x="${x}" y="${y}" font-size="${+p.h.toFixed(4)}" text-anchor="${p.anchor}"${base}${tr}>${spans}</text>`);
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
  if (d.gdt.length) {
    out.push('', `## Geometrik toleranslar – tolerans çerçeveleri (${d.gdt.length})`);
    for (const g of byPos(d.gdt)) out.push(`- ${g.text.replace(/\n/g, ' / ')} · konum ${at(g)} · katman ${g.layer}`);
  }
  if (d.frames.length) {
    out.push('', `## Tolerans çerçeveleri – çizgiyle çizilmiş kutulardan okundu (${d.frames.length} satır)`);
    out.push('Hücreler soldan sağa " | " ile ayrıldı. [sembol] = sembol çizgiyle çizilmiş, adını görüntüden/bölge dökümünden al. Tek harfli hücreler referanslardır (datum); tolerans değerinin yanındaki M/L/P/E daire içindeki değiştiricidir. Aynı "çerçeve" numaralı satırlar tek bir çok satırlı çerçevedir.');
    for (const f of byPos(d.frames)) out.push(`- çerçeve ${f.stack}${f.label ? ` (üstündeki yazı: ${f.label})` : ''}: ${f.symbolCell ? '[sembol] | ' : ''}${f.cells.join(' | ')} · konum ${at(f)}`);
  }
  if (d.datums.length) {
    out.push('', '## Referans (datum) işaretleri – kutu içindeki tek harfler');
    for (const t of byPos(d.datums)) out.push(`- ${t.text} · konum ${at({ x: t.cx ?? t.x, y: t.cy ?? t.y })}`);
  }
  if (d.dims.length) {
    out.push('', `## Ölçüler (${d.dims.length}) – görünen metin, tolerans dahil; [TED] = kutu içinde, teorik tam ölçü`);
    for (const m of byPos(d.dims).slice(0, 3000)) out.push(`- ${m.kind}: ${m.text}${m.basic ? ' [TED]' : ''}${m.measurement !== undefined ? ` (gerçek ölçü ${fmt(m.measurement)})` : ''} · konum ${at(m)} · katman ${m.layer}`);
  }
  // Çerçeve ve referans yazıları yukarıda satır olarak verildi; tek tek tekrar edilmez.
  const texts = uniq(byPos(d.texts.filter((t) => !t.grouped)), (t) => `${t.text}|${Math.round(t.x)}|${Math.round(t.y)}`);
  if (texts.length) {
    out.push('', `## Yazılar ve notlar (${texts.length}) – yukarıdan aşağıya`);
    for (const t of texts.slice(0, 4000)) out.push(`- ${at(t)} ${t.text.replace(/\n/g, ' / ')}${t.block ? ` [blok ${t.block}]` : ''} · katman ${t.layer}`);
  }
  if (!d.attribs.length && !d.dims.length && !d.gdt.length && !texts.length) out.push('', '(Dosyada okunabilir yazı veya ölçü bulunamadı.)');
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
