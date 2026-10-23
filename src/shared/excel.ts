// Excel raporu (exceljs). Ana süreçte (Node) çalışır. Renkler uygulamanın pastel temasıyla aynı.
import ExcelJS from 'exceljs';
import { COLUMNS, cellText } from './columns';
import { TABLE_LABEL } from './model';
import { personSummary, totals } from './summary';
import type { AnyRow, Project, TableKey } from './types';

const HEAD = 'FF5B4BB7';
const FILL = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFDCD6EA' } },
  left: { style: 'thin', color: { argb: 'FFDCD6EA' } },
  bottom: { style: 'thin', color: { argb: 'FFDCD6EA' } },
  right: { style: 'thin', color: { argb: 'FFDCD6EA' } },
};
const ROSE = 'FFFBE1E7';
const BUTTER = 'FFFBF1CF';
const MINT = 'FFDCF3E8';
const SKY = 'FFE0ECFA';

function colorFor(key: string, text: string): string | null {
  if (!text) return null;
  if (key === 'late' || (key === 'priority' && text === 'Critical')) return ROSE;
  if (key === 'workStatus') return text === 'Kapandı' ? MINT : text === 'Atanmadı' ? BUTTER : SKY;
  if (key === 'priority' && text === 'Important') return BUTTER;
  if (/VERİ YOK/.test(text)) return BUTTER;
  if (key === 'approval' && text === 'AI Proposed') return BUTTER;
  return null;
}

function title(ws: ExcelJS.Worksheet, p: Project, text: string, width: number) {
  ws.mergeCells(1, 1, 1, Math.max(width, 4));
  const c = ws.getCell(1, 1);
  c.value = `${text} – ${[p.meta.name, p.meta.partNumber].filter(Boolean).join(' · ') || 'Proje'}`;
  c.font = { bold: true, size: 14, color: { argb: HEAD } };
  ws.mergeCells(2, 1, 2, Math.max(width, 4));
  const s = ws.getCell(2, 1);
  s.value = `Rapor tarihi: ${new Date().toLocaleString('tr-TR')}. AI önerileri onaylanana kadar müşteri gereksinimi yerine geçmez.`;
  s.font = { italic: true, size: 9, color: { argb: 'FF5D5A72' } };
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths: number[]) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = FILL(HEAD);
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = BORDER;
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.getRow(row).height = 30;
}

function tableSheet(wb: ExcelJS.Workbook, p: Project, key: TableKey) {
  const cols = COLUMNS[key];
  const ws = wb.addWorksheet(TABLE_LABEL[key], { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  title(ws, p, TABLE_LABEL[key], cols.length + 1);
  header(ws, 3, ['ID', ...cols.map((c) => c.label)], [10, ...cols.map((c) => Math.max(8, Math.round(c.width / 7)))]);
  const rows = p[key] as AnyRow[];
  rows.forEach((r, ri) => {
    const rowNo = 4 + ri;
    const id = ws.getCell(rowNo, 1);
    id.value = r.id;
    id.font = { bold: true };
    id.border = BORDER;
    cols.forEach((c, ci) => {
      const cell = ws.getCell(rowNo, ci + 2);
      const text = cellText(c, r, p);
      cell.value = text;
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.border = BORDER;
      cell.font = { size: 9 };
      const color = colorFor(c.key, text);
      if (color) cell.fill = FILL(color);
    });
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + Math.max(rows.length, 1), column: cols.length + 1 } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' };
}

function summarySheet(wb: ExcelJS.Workbook, p: Project) {
  const ws = wb.addWorksheet('Özet');
  title(ws, p, 'Gereksinim Takip Özeti', 9);
  const t = totals(p);
  const lines: [string, number | string][] = [
    ['Gereksinim', t.requirements], ['Açık konu', t.issuesOpen], ['Atanmamış', t.unassigned], ['Planner\'a gönderilmemiş', t.notSent],
    ['Açık atama', t.open], ['Gecikmiş (açık)', t.overdue], ['Kapanan', t.closed], ['Geç kapanan', t.lateClosed], ['Toplam gecikme (gün)', t.delayDays], ['Kabul kriteri VERİ YOK', t.noData], ['Kanıt türü boş', t.noEvidence],
  ];
  lines.forEach(([l, v], i) => {
    ws.getCell(4 + i, 1).value = l;
    ws.getCell(4 + i, 2).value = v;
    ws.getCell(4 + i, 1).font = { bold: true };
  });
  const start = 6 + lines.length;
  header(ws, start, ['Kişi', 'Disiplin', 'Toplam', 'Açık', 'Gecikmiş', 'Kapanan', 'Zamanında kapanan', 'Zamanında %', 'Gecikme (gün)'], [24, 16, 10, 10, 10, 10, 18, 14, 14]);
  personSummary(p).forEach((s, i) => {
    const vals = [s.name, s.discipline, s.total, s.open, s.overdue, s.closed, s.closedOnTime, s.onTimeRate ?? '', s.delayDays];
    vals.forEach((v, j) => {
      const c = ws.getCell(start + 1 + i, j + 1);
      c.value = v;
      c.border = BORDER;
      if ((j === 4 || j === 8) && Number(v) > 0) c.fill = FILL(ROSE);
    });
  });
  const rows = personSummary(p);
  const sum = (f: (s: (typeof rows)[number]) => number) => rows.reduce((n, s) => n + f(s), 0);
  const closed = sum((s) => s.closed);
  const onTime = sum((s) => s.closedOnTime);
  const totalRow = ['Proje toplamı', '', sum((s) => s.total), sum((s) => s.open), sum((s) => s.overdue), closed, onTime, closed ? Math.round((onTime / closed) * 100) : '', sum((s) => s.delayDays)];
  totalRow.forEach((v, j) => {
    const c = ws.getCell(start + 1 + rows.length, j + 1);
    c.value = v;
    c.border = BORDER;
    c.font = { bold: true };
  });
}

function logSheet(wb: ExcelJS.Workbook, p: Project) {
  const ws = wb.addWorksheet('Planner Günlüğü');
  header(ws, 1, ['Zaman', 'Tür', 'Olay'], [20, 8, 100]);
  p.syncLog.forEach((l, i) => {
    ws.getCell(2 + i, 1).value = new Date(l.at).toLocaleString('tr-TR');
    ws.getCell(2 + i, 2).value = l.kind;
    ws.getCell(2 + i, 3).value = l.text;
  });
}

export async function buildWorkbook(p: Project): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gereksinim Takip';
  wb.created = new Date();
  // Rapor yalnızca bu projede iş atanmış kişileri gösterir; kayıtlı ekibin geri kalanı rapora girmez
  const assigned = new Set([...p.requirements, ...p.issues].map((r) => r.assignee).filter(Boolean));
  const team: Project = { ...p, people: p.people.filter((x) => assigned.has(x.id)) };
  summarySheet(wb, team);
  tableSheet(wb, p, 'requirements');
  tableSheet(wb, p, 'issues');
  tableSheet(wb, p, 'documents');
  tableSheet(wb, team, 'people');
  logSheet(wb, p);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
