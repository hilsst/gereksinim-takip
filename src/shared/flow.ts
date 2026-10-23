// Power Automate modu: uygulama ile Planner arasındaki alışveriş OneDrive/SharePoint ile senkron bir klasördeki
// JSON dosyalarıyla yapılır. "giden" klasörüne uygulama yazar, akış okur; "gelen" klasörüne akış yazar, uygulama okur.
// Azure uygulama kaydı ve Premium lisans gerekmez. Bu dosya yalnızca kuralları içerir; dosya işlemleri ana süreçtedir.
import { closureFromDescription, isClosed, personName, taskDescription, taskTitle } from './model';
import { toPlannerDate, type RowPatch, type SyncResult } from './planner';
import type { AssignableTable, IssueRow, Project, RequirementRow, SyncLogEntry } from './types';

export const OUT_DIR = 'giden';
export const IN_DIR = 'gelen';
export const DONE_DIR = 'islenen';
/** Kuyruğa alınmış ama akıştan henüz görev kimliği dönmemiş satır işareti. */
export const QUEUED = 'flow:kuyrukta';

/** Uygulamanın akışa yazdığı istek. Alan adları akışta kolay seçilsin diye Türkçe ve düz tutuldu. */
export interface FlowRequest {
  kaynak: 'gereksinim-takip';
  islem: 'olustur' | 'guncelle';
  kayitId: string;
  gorevId: string;
  baslik: string;
  aciklama: string;
  bitisTarihi: string;
  sorumluEposta: string;
  kova: string;
  proje: string;
}

/** Akışın gelen klasörüne yazdığı olay. */
export interface FlowEvent {
  olay: 'olusturuldu' | 'tamamlandi' | 'hata';
  kayitId?: string;
  gorevId?: string;
  baslik?: string;
  aciklama?: string;
  tamamlanmaTarihi?: string;
  tamamlayan?: string;
  mesaj?: string;
}

type Row = RequirementRow | IssueRow;
const now = () => new Date().toISOString();
const log = (text: string, kind: SyncLogEntry['kind'] = 'ok'): SyncLogEntry => ({ at: now(), text, kind });
const stamp = () => now().replace(/[-:T]/g, '').slice(0, 14);

function rowsOf(p: Project): { table: AssignableTable; row: Row }[] {
  return [...p.requirements.map((row) => ({ table: 'requirements' as const, row })), ...p.issues.map((row) => ({ table: 'issues' as const, row }))];
}

/** "REQ-012 · …" başlığından kayıt kimliğini okur. */
export function idFromTitle(title: string | undefined): string {
  return title?.match(/^\s*((?:REQ|ISS)-\d+)/)?.[1] ?? '';
}

export function buildRequests(p: Project, ids: string[]): { files: { name: string; content: string }[]; result: SyncResult } {
  const files: { name: string; content: string }[] = [];
  const result: SyncResult = { patches: [], planner: {}, log: [] };
  for (const { table, row } of rowsOf(p).filter((x) => ids.includes(x.row.id))) {
    if (isClosed(row)) {
      result.log.push(log(`${row.id}: kapalı/iptal, gönderilmedi`, 'warn'));
      continue;
    }
    if (row.plannerEtag === QUEUED && !row.plannerTaskId) {
      result.log.push(log(`${row.id}: önceki gönderim hâlâ akışı bekliyor; çift görev açılmaması için tekrar gönderilmedi`, 'warn'));
      continue;
    }
    const person = p.people.find((x) => x.id === row.assignee);
    if (!person) {
      result.log.push(log(`${row.id}: gönderilemedi – sorumlu kişi seçilmemiş`, 'err'));
      continue;
    }
    if (!person.email) {
      result.log.push(log(`${row.id}: gönderilemedi – ${person.name} için Ekip sekmesinde e-posta yok`, 'err'));
      continue;
    }
    if (!row.dueDate) {
      result.log.push(log(`${row.id}: gönderilemedi – miat girilmemiş`, 'err'));
      continue;
    }
    const req: FlowRequest = {
      kaynak: 'gereksinim-takip',
      islem: row.plannerTaskId ? 'guncelle' : 'olustur',
      kayitId: row.id,
      gorevId: row.plannerTaskId,
      baslik: taskTitle(row),
      aciklama: taskDescription(p, row),
      bitisTarihi: toPlannerDate(row.dueDate)!,
      sorumluEposta: person.email,
      kova: row.discipline || 'Genel',
      proje: [p.meta.name, p.meta.partNumber].filter(Boolean).join(' · '),
    };
    files.push({ name: `GT_${row.id}_${stamp()}.json`, content: JSON.stringify(req, null, 2) });
    const fields: Record<string, unknown> = { plannerSyncedAt: now() };
    if (!row.plannerTaskId) Object.assign(fields, { plannerEtag: QUEUED, workStatus: 'Atandı' });
    result.patches.push({ table, id: row.id, fields });
    result.log.push(log(`${row.id} → ${person.name}: ${req.islem === 'olustur' ? 'görev isteği' : 'güncelleme isteği'} Power Automate'e bırakıldı (miat ${row.dueDate})`));
  }
  return { files, result };
}

/** Gelen klasöründeki olayları satırlara uygular. Tanınmayan dosyalar günlüğe yazılır, uygulama bozulmaz. */
export function applyEvents(p: Project, events: { name: string; event: FlowEvent | null; error?: string }[]): SyncResult {
  const result: SyncResult = { patches: [], planner: { lastSync: now() }, log: [] };
  const all = rowsOf(p);
  const pending = new Map<string, Record<string, unknown>>();
  const patch = (table: AssignableTable, id: string, fields: Record<string, unknown>) => {
    const key = `${table}:${id}`;
    pending.set(key, { ...(pending.get(key) ?? {}), ...fields });
  };
  // Aynı turda "oluşturuldu" ve "tamamlandı" gelirse görev kimliği önce eşleşsin
  const order = (e: FlowEvent | null) => (e?.olay === 'olusturuldu' ? 0 : 1);
  const taskOf = new Map(all.filter((x) => x.row.plannerTaskId).map((x) => [x.row.plannerTaskId, x]));

  for (const { name, event, error } of [...events].sort((a, b) => order(a.event) - order(b.event))) {
    if (!event) {
      result.log.push(log(`${name}: okunamadı – ${error ?? 'geçersiz JSON'}`, 'err'));
      continue;
    }
    if (event.olay === 'hata') {
      result.log.push(log(`Power Automate hatası${event.kayitId ? ` (${event.kayitId})` : ''}: ${event.mesaj ?? name}`, 'err'));
      const hit = all.find((x) => x.row.id === event.kayitId);
      if (hit && !hit.row.plannerTaskId) patch(hit.table, hit.row.id, { plannerEtag: '' });
      continue;
    }
    const byId = event.gorevId ? taskOf.get(event.gorevId) : undefined;
    const kid = event.kayitId || idFromTitle(event.baslik);
    const hit = byId ?? all.find((x) => x.row.id === kid);
    if (!hit) {
      result.log.push(log(`${name}: eşleşen gereksinim/açık konu bulunamadı (${kid || event.gorevId || 'kimlik yok'})`, 'warn'));
      continue;
    }
    const { table, row } = hit;
    if (event.olay === 'olusturuldu') {
      if (!event.gorevId) {
        result.log.push(log(`${row.id}: akış görev kimliği göndermedi`, 'warn'));
        continue;
      }
      patch(table, row.id, { plannerTaskId: event.gorevId, plannerEtag: '', plannerSyncedAt: now() });
      taskOf.set(event.gorevId, hit);
      result.log.push(log(`${row.id}: Planner görevi açıldı`));
    } else if (event.olay === 'tamamlandi') {
      if (row.workStatus === 'Kapandı') continue;
      const note = closureFromDescription(event.aciklama ?? '');
      const fields: Record<string, unknown> = {
        workStatus: 'Kapandı',
        closedAt: event.tamamlanmaTarihi || now(),
        closedBy: event.tamamlayan || (row.assignee ? personName(p, row.assignee) : ''),
        closureNote: note,
        plannerEtag: '',
        plannerSyncedAt: now(),
      };
      if (event.gorevId && !row.plannerTaskId) fields.plannerTaskId = event.gorevId;
      if (table === 'issues') fields.status = 'Closed';
      patch(table, row.id, fields);
      result.log.push(log(`${row.id}: Planner'da tamamlandı, kapatıldı${note ? '' : ' (açıklama boş)'}`, note ? 'ok' : 'warn'));
    }
  }
  for (const [key, fields] of pending) {
    const [table, id] = key.split(':') as [AssignableTable, string];
    result.patches.push({ table, id, fields } as RowPatch);
  }
  return result;
}

/** Akış kurulum tarifinde kullanılan Parse JSON şemaları. */
export const REQUEST_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(['kaynak', 'islem', 'kayitId', 'gorevId', 'baslik', 'aciklama', 'bitisTarihi', 'sorumluEposta', 'kova', 'proje'].map((k) => [k, { type: 'string' }])),
};
