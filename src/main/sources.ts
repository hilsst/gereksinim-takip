// Yüklenen kaynak dosyaları Claude içerik bloklarına çevirir: PDF ve görseller olduğu gibi,
// Word / Excel / e-posta metne dönüştürülerek gönderilir. E-posta ekleri de aynı kurallarla işlenir.
import type Anthropic from '@anthropic-ai/sdk';
import MsgReader from '@kenjiuno/msgreader';
import ExcelJS from 'exceljs';
import { simpleParser } from 'mailparser';
import mammoth from 'mammoth';
import fs from 'node:fs/promises';
import path from 'node:path';

type Block = Anthropic.Beta.BetaContentBlockParam;
type Json = Record<string, unknown>;

export const SUPPORTED = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'xlsx', 'xlsm', 'csv', 'txt', 'md', 'eml', 'msg', 'htm', 'html'];

const IMAGE: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

/** Word tablolarını kaybetmemek için HTML'i satır/hücre ayraçlı düz metne çevirir. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // Hücre içi paragraflar satırı bölmesin
    .replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag: string, attrs: string, inner: string) => `<${tag}${attrs}>${inner.replace(/<\/p>\s*<p[^>]*>/gi, ' / ').replace(/<\/?p[^>]*>/gi, '')}</${tag}>`)
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|table|ul|ol)>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function excelText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((ws) => {
    parts.push(`### Sayfa: ${ws.name}`);
    ws.eachRow((row, n) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object') {
          const o = v as Json;
          if ('richText' in o) return (o.richText as { text: string }[]).map((x) => x.text).join('');
          if ('text' in o) return String(o.text);
          if ('result' in o) return String(o.result);
          if (v instanceof Date) return v.toISOString().slice(0, 10);
        }
        return String(v);
      });
      parts.push(`R${n}: ${vals.join(' | ')}`);
    });
  });
  return parts.join('\n');
}

const text = (t: string): Block => ({ type: 'text', text: t });

/** depth: e-posta içindeki e-postalar için sınır. */
export async function toBlocks(buf: Buffer, name: string, depth = 0): Promise<Block[]> {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: name }];
  if (IMAGE[ext]) return [{ type: 'image', source: { type: 'base64', media_type: IMAGE[ext], data: buf.toString('base64') } }, text(`Görsel dosya: ${name}`)];
  if (ext === '.docx') {
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return [text(`Word dosyası: ${name}\n${htmlToText(value)}`)];
  }
  if (ext === '.xlsx' || ext === '.xlsm') return [text(`Excel dosyası: ${name}\n${await excelText(buf)}`)];
  if (ext === '.eml') {
    const m = await simpleParser(buf);
    const head = [`E-posta: ${name}`, `Konu: ${m.subject ?? ''}`, `Gönderen: ${m.from?.text ?? ''}`, `Alıcı: ${Array.isArray(m.to) ? m.to.map((x) => x.text).join(', ') : m.to?.text ?? ''}`, `Tarih: ${m.date?.toISOString() ?? ''}`];
    const body = m.text || (m.html ? htmlToText(m.html) : '');
    const out: Block[] = [text(`${head.join('\n')}\n\n${body}`)];
    for (const a of m.attachments ?? []) {
      if (a.contentDisposition === 'inline' && a.contentType.startsWith('image/') && a.size < 20_000) continue; // imza logoları
      out.push(...(await attachment(a.content, a.filename || 'ek', depth)));
    }
    return out;
  }
  if (ext === '.msg') {
    const reader = new MsgReader(new Uint8Array(buf).buffer);
    const d = reader.getFileData();
    if (d.error) throw new Error(`${name}: ${d.error}`);
    const head = [`E-posta: ${name}`, `Konu: ${d.subject ?? ''}`, `Gönderen: ${d.senderName ?? ''} <${d.senderSmtpAddress ?? d.senderEmail ?? ''}>`, `Tarih: ${d.clientSubmitTime ?? d.messageDeliveryTime ?? ''}`];
    const body = d.body || (d.bodyHtml ? htmlToText(d.bodyHtml) : '');
    const out: Block[] = [text(`${head.join('\n')}\n\n${body}`)];
    for (const att of d.attachments ?? []) {
      if (att.attachmentHidden) continue;
      const a = reader.getAttachment(att);
      out.push(...(await attachment(Buffer.from(a.content), a.fileName || att.fileName || 'ek', depth)));
    }
    return out;
  }
  if (ext === '.htm' || ext === '.html') return [text(`Dosya: ${name}\n${htmlToText(buf.toString('utf8'))}`)];
  if (['.txt', '.md', '.csv'].includes(ext)) return [text(`Dosya: ${name}\n${buf.toString('utf8')}`)];
  if (ext === '.doc' || ext === '.xls') throw new Error(`${name}: eski Office biçimi desteklenmiyor. Dosyayı .docx / .xlsx olarak kaydedip tekrar yükleyin.`);
  throw new Error(`${name}: desteklenmeyen dosya türü (${ext || 'uzantısız'}).`);
}

async function attachment(buf: Buffer, name: string, depth: number): Promise<Block[]> {
  const ext = path.extname(name).toLowerCase().slice(1);
  if (!SUPPORTED.includes(ext) || ((ext === 'eml' || ext === 'msg') && depth >= 2)) return [text(`(Ek atlandı: ${name})`)];
  try {
    return [text(`--- E-posta eki: ${name} ---`), ...(await toBlocks(buf, name, depth + 1))];
  } catch (e) {
    return [text(`(Ek okunamadı: ${name} – ${e instanceof Error ? e.message : e})`)];
  }
}

export async function fileBlocks(filePath: string): Promise<Block[]> {
  return toBlocks(await fs.readFile(filePath), path.basename(filePath));
}
