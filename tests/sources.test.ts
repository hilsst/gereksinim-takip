import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { docxMedia, htmlToText, toBlocks } from '../src/main/sources';

const texts = (b: Awaited<ReturnType<typeof toBlocks>>) => b.map((x) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n');

describe('Kaynak dönüştürme', () => {
  it('HTML tablolarını satır/hücre ayracıyla korur', () => {
    expect(htmlToText('<table><tr><td>Kütle</td><td>≤ 2.4 kg</td></tr></table><p>Not&nbsp;1</p>')).toBe('Kütle | ≤ 2.4 kg |\n\nNot 1');
  });

  it('.eml gövdesini ve ekini okur', async () => {
    const eml = [
      'From: Ali Yilmaz <ali@musteri.com>',
      'To: kemal@firma.com',
      'Subject: Boya rengi',
      'Date: Tue, 20 Oct 2026 10:00:00 +0300',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Renk RAL 7035 olmali.',
      '--b1',
      'Content-Type: text/plain; name="not.txt"',
      'Content-Disposition: attachment; filename="not.txt"',
      '',
      'Kalinlik 60-90 um',
      '--b1--',
      '',
    ].join('\r\n');
    const t = texts(await toBlocks(Buffer.from(eml), 'boya.eml'));
    expect(t).toContain('Konu: Boya rengi');
    expect(t).toContain('Ali Yilmaz');
    expect(t).toContain('RAL 7035');
    expect(t).toContain('E-posta eki: not.txt');
    expect(t).toContain('Kalinlik 60-90 um');
  });

  it('Word paragraflarını ve tablolarını okur', async () => {
    const t = texts(await toBlocks(fs.readFileSync(path.join(__dirname, 'fixtures', 'sartname.docx')), 'sartname.docx'));
    expect(t).toContain('# Teknik Şartname TS-220');
    expect(t).toContain('2.4 kg değerini aşmamalıdır');
    expect(t).toMatch(/Tuz sisi \|\s+96 saat/);
  });

  it('Excel sayfalarını satır numarasıyla okur', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Gereksinimler');
    ws.addRow(['No', 'Gereksinim']);
    ws.addRow([1, 'Tuz sisi 96 saat']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const t = texts(await toBlocks(buf, 'liste.xlsx'));
    expect(t).toContain('### Sayfa: Gereksinimler');
    expect(t).toContain('R2: 1 | Tuz sisi 96 saat');
  });

  it('PDF ve görselleri doğrudan gönderir, eski biçimleri reddeder', async () => {
    expect((await toBlocks(Buffer.from('%PDF-1.4'), 'resim.pdf'))[0].type).toBe('document');
    expect((await toBlocks(Buffer.from([0x89, 0x50]), 'a.png'))[0].type).toBe('image');
    await expect(toBlocks(Buffer.from(''), 'eski.doc')).rejects.toThrow(/docx/);
  });

  it('Word dosyasına gömülü görselleri büyükten küçüğe çıkarır, EMF/WMF sayar', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Resim 1</w:t></w:r><w:r><w:t xml:space="preserve"> parça </w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/media/image1.png', new Uint8Array(10));
    zip.file('word/media/image2.jpeg', new Uint8Array(500));
    zip.file('word/media/image3.emf', new Uint8Array(50));
    const m = await docxMedia(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(m.images.map((i) => i.name)).toEqual(['image2.jpeg', 'image1.png']);
    expect(m.vector).toBe(1);
    expect(m.textChars).toBe('Resim 1'.length + 'parça'.length);
  });
});
