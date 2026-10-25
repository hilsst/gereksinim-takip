// Ekran tabloları ve Excel çıktısı için ortak kolon tanımları.
import { delayDays, LISTS, personName } from './model';
import { rowTitle } from './history';
import type { AnyRow, Assignable, Project, TableKey } from './types';

export type ColType = 'text' | 'long' | 'select' | 'person' | 'doc' | 'bool' | 'date' | 'computed';

export interface Col {
  key: string;
  label: string;
  width: number;
  type: ColType;
  options?: string[];
  compute?: (row: AnyRow, p: Project) => string | number | null;
  readonly?: boolean;
  help?: string;
  /** "Tüm kolonlar" kapalıyken gizlenen ikincil kolon. */
  secondary?: boolean;
}

const t = (key: string, label: string, width = 160, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'text', ...extra });
const long = (key: string, label: string, width = 220, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'long', ...extra });
const sel = (key: string, label: string, options: string[], width = 140, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'select', options, ...extra });
const comp = (key: string, label: string, compute: Col['compute'], width = 80, help?: string): Col => ({ key, label, width, type: 'computed', compute, readonly: true, help });

const assignCols = (): Col[] => [
  sel('discipline', 'Disiplin', LISTS.discipline, 120),
  { key: 'assignee', label: 'Sorumlu', width: 150, type: 'person' },
  { key: 'assignedAt', label: 'Atama Tarihi', width: 125, type: 'date' },
  { key: 'dueDate', label: 'Miat', width: 125, type: 'date' },
  sel('workStatus', 'Durum', LISTS.workStatus, 125, { help: 'Planner\'da görev tamamlanınca otomatik "Kapandı" olur' }),
  comp('late', 'Gecikme', (r) => {
    const d = delayDays(r as unknown as Assignable);
    return d ? `${d} gün` : '';
  }, 90, 'Miattan sonra geçen gün; iş kapandıysa kapanış gününe kadar sayılır ve korunur'),
  comp('planner', 'Planner', (r) => {
    const a = r as unknown as Assignable;
    return a.plannerTaskId ? 'Gönderildi' : a.plannerEtag === 'flow:kuyrukta' ? 'Kuyrukta' : '';
  }, 90, 'Gönderildi: Planner görevine bağlı · Kuyrukta: Power Automate görevi henüz açmadı'),
  long('closureNote', 'Kapanış Açıklaması (Planner)', 240, { readonly: true }),
  t('closedAt', 'Kapanış', 110, { readonly: true, secondary: true }),
  t('closedBy', 'Kapatan', 120, { readonly: true, secondary: true }),
];

const sourceCols = (): Col[] => [
  { key: 'sourceDocId', label: 'Kaynak Doküman', width: 170, type: 'doc', help: 'Gereksinimin çıktığı doküman (Dokümanlar tablosundan)' },
  t('sourceRef', 'Kaynak Yeri', 150, { help: 'Doküman içindeki yer: sayfa, madde, ölçü no, e-posta tarihi' }),
];

/** Silinenler gösterilirken tabloya eklenen kolonlar. */
export const DELETED_COLS: Col[] = [
  t('deletedAt', 'Silinme', 110, { readonly: true }),
  t('deletedBy', 'Silen', 110, { readonly: true }),
  long('deleteReason', 'Silme Gerekçesi', 200, { readonly: true }),
];

export const COLUMNS: Record<TableKey, Col[]> = {
  documents: [
    t('name', 'Doküman Adı', 220),
    sel('docType', 'Tip', LISTS.docType, 150),
    t('docNumber', 'Doküman No', 120),
    t('revision', 'Revizyon', 80),
    { key: 'date', label: 'Tarih', width: 125, type: 'date' },
    t('source', 'Kaynak / Gönderen', 150),
    long('notes', 'Notlar', 220),
    t('filePath', 'Dosya', 200, { readonly: true }),
    comp('reqCount', 'Gereksinim', (r, p) => p.requirements.filter((q) => q.sourceDocId === r.id && !q.deletedAt).length || '', 90, 'Bu dokümanı kaynak gösteren gereksinim sayısı'),
    t('extractedAt', 'AI Çıkarma', 140, { readonly: true, secondary: true }),
  ],
  requirements: [
    long('text', 'Gereksinim', 300),
    sel('reqType', 'Tip', LISTS.reqType, 130),
    long('acceptance', 'Kabul Kriteri', 200),
    sel('evidenceType', 'Kanıt Türü', LISTS.evidenceType, 140),
    long('evidence', 'Kanıt (nasıl gösterilecek)', 240, { help: 'Beklenen kanıt: rapor, ölçüm kaydı, model görüntüsü, sertifika…' }),
    ...sourceCols(),
    sel('confidence', 'AI Güven', LISTS.confidence, 80, { secondary: true }),
    sel('dataStatus', 'Veri Durumu', LISTS.dataStatus, 170, { secondary: true }),
    sel('approval', 'Onay', LISTS.approval, 130),
    ...assignCols(),
    long('notes', 'Notlar', 180, { secondary: true }),
  ],
  issues: [
    long('description', 'Konu / Eksik Bilgi', 280),
    sel('priority', 'Öncelik', LISTS.priority, 100),
    ...sourceCols(),
    long('risk', 'Risk', 180),
    t('relatedReq', 'İlgili Gereksinim', 120),
    long('recommendedAction', 'Önerilen Aksiyon', 200),
    sel('status', 'Konu Durumu', LISTS.issueStatus, 130),
    long('answer', 'Cevap / Karar', 200),
    ...assignCols(),
  ],
  people: [
    t('name', 'Ad Soyad', 200),
    sel('discipline', 'Disiplin', LISTS.discipline, 140),
    t('email', 'E-posta (Microsoft 365)', 260, { help: 'Planner ataması bu hesapla yapılır' }),
    { key: 'active', label: 'Aktif', width: 60, type: 'bool' },
    comp('linked', 'M365', (r) => ((r as { aadId?: string }).aadId ? 'Eşleşti' : ''), 80, 'İlk Planner gönderiminde hesap eşleştirilir'),
    comp('openCount', 'Açık iş', (r, p) => [...p.requirements, ...p.issues].filter((x) => x.assignee === r.id && !x.deletedAt && x.workStatus !== 'Kapandı' && x.workStatus !== 'İptal').length || '', 80),
  ],
};

export function cellText(col: Col, row: AnyRow, p: Project): string {
  if (col.compute) {
    const v = col.compute(row, p);
    return v == null ? '' : String(v);
  }
  const v = (row as unknown as Record<string, unknown>)[col.key];
  if (col.type === 'person') return v ? personName(p, String(v)) : '';
  if (col.type === 'doc') return v ? docLabel(p, String(v)) : '';
  if (col.key === 'deletedAt') return v ? String(v).slice(0, 10) : '';
  if (col.type === 'bool') return v ? 'Evet' : '';
  if (Array.isArray(v)) return v.join(', ');
  return v == null ? '' : String(v);
}

/** "DOC-002 · Teknik şartname" */
export function docLabel(p: Project, id: string): string {
  const d = p.documents.find((x) => x.id === id);
  return d ? [id, rowTitle(d)].filter(Boolean).join(' · ') : id;
}

const EXTRA_LABELS: Record<string, string> = { deletedAt: 'Silinme', deletedBy: 'Silen', deleteReason: 'Silme Gerekçesi', plannerTaskId: 'Planner görevi', active: 'Aktif' };

/** Günlükteki alan adının ekrandaki karşılığı. */
export function fieldLabel(table: TableKey, field: string): string {
  if (!field) return '';
  return COLUMNS[table].find((c) => c.key === field)?.label ?? EXTRA_LABELS[field] ?? field;
}
