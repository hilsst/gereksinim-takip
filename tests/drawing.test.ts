import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanText, dxfSummary, gdtText, parseDxf } from '../src/main/dxf';
import { toBlocks } from '../src/main/sources';
import { grid, MAX_EDGE, needsRaster, pickEdge, TILE, tileBudget } from '../src/shared/raster';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'plaka.dxf'));

describe('DXF teknik resim', () => {
  it('MTEXT biçim kodlarını temizler, toleransı ve özel işaretleri korur', () => {
    expect(cleanText('\\A0;120{\\H0.50x;\\S+0.20^ -0.10;}')).toBe('120 +0.20/-0.10');
    expect(cleanText('%%c12 H7')).toBe('Ø12 H7');
    expect(cleanText('{\\fArial|b0|i0;NOT}\\P1. Y\\U+00FCzey')).toBe('NOT\n1. Yüzey');
    expect(cleanText('45%%d %%p0.1')).toBe('45° ±0.1');
  });

  it('ölçüleri, notları ve antet özniteliklerini okur', () => {
    const d = parseDxf(fixture);
    expect(d.units).toBe('mm');
    expect(d.attribs.map((a) => `${a.tag}=${a.text}`)).toEqual(['PARCA_NO=BRK-2207', 'REV=C', 'MALZEME=EN AW-6082 T6']);
    expect(d.dims).toHaveLength(3);
    expect(d.dims.find((x) => x.kind === 'Çap')?.text).toMatch(/^Ø/);
    expect(d.dims.some((x) => x.text.includes('+0.20/-0.10'))).toBe(true);
    expect(d.dims.some((x) => x.text.endsWith('H7'))).toBe(true);
    const notes = d.texts.map((t) => t.text).join('\n');
    expect(notes).toContain('ISO 2768-mK');
    expect(notes).toContain('Yüzey işlem: Anodize');
    expect(notes).toContain('Ra 1.6');
    // Ölçü yazıları notlar arasında tekrar etmez
    expect(notes).not.toContain('H7');
  });

  it('AutoCAD TOLERANCE (GD&T çerçevesi) nesnelerini okur', () => {
    expect(gdtText('{\\Fgdt;j}%%v{\\Fgdt;n}0.2{\\Fgdt;m}%%vA%%vB%%vC')).toBe('Konum | Ø0.2 (M) | A | B | C');
    expect(gdtText('{\\Fgdt;b}%%v{\\Fgdt;n}0.03%%vA%%v%%v^J{\\Fgdt;g}%%v0.01%%v%%v%%v')).toBe('Diklik | Ø0.03 | A\nSilindiriklik | 0.01');
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'TOLERANCE', '8', 'GDT', '1', '{\\Fgdt;c}%%v0.05', '10', '12', '20', '34', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
    const d = parseDxf(Buffer.from(dxf));
    expect(d.gdt.map((g) => g.text)).toEqual(['Düzlemsellik | 0.05']);
    expect(dxfSummary('t.dxf', d)).toContain('## Geometrik toleranslar');
  });

  it('model alanını SVG olarak çizer', () => {
    const d = parseDxf(fixture);
    expect(d.svg).toMatch(/^<svg [^>]*viewBox="[^"]+"/);
    expect(d.svg).toContain('<path');
    expect(d.svg).toContain('ISO 2768-mK');
  });

  it('özet metni Claude için bölümler halinde verir', () => {
    const s = dxfSummary('plaka.dxf', parseDxf(fixture));
    expect(s).toContain('## Antet ve blok öznitelikleri');
    expect(s).toContain('- REV: C');
    expect(s).toMatch(/## Ölçüler \(3\)/);
    expect(s).toContain('## Yazılar ve notlar');
  });

  it('DXF metin olarak, DWG dönüştürücü yoksa anlaşılır hatayla işlenir', async () => {
    const b = await toBlocks(fixture, 'plaka.dxf');
    expect(b[0].type === 'text' && b[0].text).toContain('BRK-2207');
    await expect(toBlocks(Buffer.from('AC1032'), 'plaka.dwg')).rejects.toThrow(/ODA File Converter/);
    await expect(toBlocks(Buffer.from('AutoCAD Binary DXF\r\n'), 'b.dxf')).rejects.toThrow(/ASCII DXF/);
  });
});

describe('Resim bölgeleme', () => {
  it('küçük görüntüyü bölmez, büyük görüntüyü örtüşen bölgelere ayırır', () => {
    expect(grid(1500, 1000)).toEqual([]);
    const t = grid(6000, 4243);
    const cols = new Set(t.map((x) => x.col)).size;
    const rows = new Set(t.map((x) => x.row)).size;
    expect(cols * rows).toBe(t.length);
    for (const x of t) {
      expect(x.w).toBeLessThanOrEqual(TILE);
      expect(x.x + x.w).toBeLessThanOrEqual(6000);
      expect(x.y + x.h).toBeLessThanOrEqual(4243);
    }
    // Kenarlar kapsanır
    expect(Math.max(...t.map((x) => x.x + x.w))).toBe(6000);
    expect(Math.max(...t.map((x) => x.y + x.h))).toBe(4243);
  });

  it('bölge bütçesine göre çözünürlüğü düşürür', () => {
    expect(pickEdge(0.707, tileBudget(1))).toBe(MAX_EDGE);
    const many = pickEdge(0.707, tileBudget(20));
    expect(many).toBeLessThan(MAX_EDGE);
    expect(grid(many, Math.round(many * 0.707)).length).toBeLessThanOrEqual(tileBudget(20));
    expect(pickEdge(0.707, 0)).toBe(TILE);
  });

  it('PDF yalnızca teknik resimse görüntüye çevrilir', () => {
    expect(needsRaster('pdf', 'Teknik resim')).toBe(true);
    expect(needsRaster('pdf', 'Teknik şartname')).toBe(false);
    expect(needsRaster('dwg', 'Diğer')).toBe(true);
    expect(needsRaster('docx', 'Teknik resim')).toBe(false);
  });
});
