// Power Automate modu: uygulama ile Planner arasındaki alışveriş OneDrive/SharePoint ile senkron bir klasördeki
// JSON dosyalarıyla yapılır. "giden" klasörüne uygulama yazar, akış okur; "gelen" klasörüne akış yazar, uygulama okur.
// Azure uygulama kaydı ve Premium lisans gerekmez. Bu dosya yalnızca kuralları içerir; dosya işlemleri ana süreçtedir.
import { checklistTitle, closureFromDescription, isClosed, personName, projectCode, startDateOf, taskDescription, taskKey, taskTitle } from './model';
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
  /** Projeler arasında tekil anahtar: "1522-REQ-001". */
  kayitId: string;
  gorevId: string;
  baslik: string;
  aciklama: string;
  /** Denetim listesi maddesi: gereksinim metni (en çok 100 karakter). */
  kontrolListesi: string;
  baslangicTarihi: string;
  bitisTarihi: string;
  sorumluEposta: string;
  kova: string;
  proje: string;
}

/** Akışın gelen klasörüne yazdığı olay. */
export interface FlowEvent {
  olay: 'olusturuldu' | 'tamamlandi' | 'hata' | 'uyeler';
  /** "uyeler" olayı: Teams grubunun üyeleri. */
  uyeler?: { ad?: string; eposta?: string; unvan?: string }[];
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

/** "1522-REQ-012" veya eski biçim "REQ-012 · …" başlığından kayıt anahtarını okur. */
export function idFromTitle(title: string | undefined): string {
  return title?.match(/^\s*((?:\S*?-)?(?:REQ|ISS)-\d+)/)?.[1] ?? '';
}

/** Anahtarı proje koduna ve kayıt kimliğine ayırır: "1522-REQ-001" → { code: "1522", id: "REQ-001" }. */
export function splitKey(key: string): { code: string; id: string } {
  const m = key.match(/^(?:(.*)-)?((?:REQ|ISS)-\d+)$/);
  return m ? { code: m[1] ?? '', id: m[2] } : { code: '', id: key };
}

export function buildRequests(p: Project, ids: string[]): { files: { name: string; content: string }[]; result: SyncResult } {
  const files: { name: string; content: string }[] = [];
  const result: SyncResult = { patches: [], planner: {}, log: [] };
  for (const { table, row } of rowsOf(p).filter((x) => ids.includes(x.row.id) && !x.row.deletedAt)) {
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
      kayitId: taskKey(p, row),
      gorevId: row.plannerTaskId,
      baslik: taskTitle(p, row),
      aciklama: taskDescription(p, row),
      kontrolListesi: checklistTitle(row),
      baslangicTarihi: toPlannerDate(startDateOf(row))!,
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

/**
 * Gelen klasöründeki olayları satırlara uygular. Tanınmayan dosyalar günlüğe yazılır, uygulama bozulmaz.
 * Başka projenin kodunu taşıyan dosyalar "keep" listesinde döner ve klasörde bırakılır (o projeyi açan alır).
 */
export function applyEvents(p: Project, events: { name: string; event: FlowEvent | null; error?: string }[]): SyncResult & { keep: string[] } {
  const result: SyncResult & { keep: string[] } = { patches: [], planner: { lastSync: now() }, log: [], keep: [] };
  const code = projectCode(p);
  /** Anahtar bu projeye mi ait? Kodsuz eski anahtarlar her projede kimlikle eşleşir. */
  const ours = (key: string) => {
    const k = splitKey(key);
    return !k.code || k.code === code ? k.id : null;
  };
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
    if (event.olay === 'uyeler') {
      const members = (event.uyeler ?? []).map((u) => ({ name: u.ad ?? '', email: u.eposta ?? '', title: u.unvan ?? '' })).filter((m) => m.name && m.email);
      result.members = [...(result.members ?? []), ...members];
      const known = new Set(p.people.map((x) => x.email.toLocaleLowerCase('en')));
      const fresh = members.filter((m) => !known.has(m.email.toLocaleLowerCase('en'))).length;
      result.log.push(log(`Teams ekibinden ${members.length} üye okundu${fresh ? `, ${fresh} kişi Ekip listesine eklendi` : ''}`));
      continue;
    }
    const key = event.kayitId || idFromTitle(event.baslik);
    const byId = event.gorevId ? taskOf.get(event.gorevId) : undefined;
    const kid = key ? ours(key) : '';
    if (!byId && kid === null) {
      result.keep.push(name);
      continue;
    }
    if (event.olay === 'hata') {
      result.log.push(log(`Power Automate hatası${event.kayitId ? ` (${event.kayitId})` : ''}: ${event.mesaj ?? name}`, 'err'));
      const hit = all.find((x) => x.row.id === kid);
      if (hit && !hit.row.plannerTaskId) patch(hit.table, hit.row.id, { plannerEtag: '' });
      continue;
    }
    const hit = byId ?? all.find((x) => x.row.id === kid);
    if (!hit) {
      result.log.push(log(`${name}: eşleşen gereksinim/açık konu bulunamadı (${key || event.gorevId || 'kimlik yok'})`, 'warn'));
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
  properties: Object.fromEntries(['kaynak', 'islem', 'kayitId', 'gorevId', 'baslik', 'aciklama', 'kontrolListesi', 'baslangicTarihi', 'bitisTarihi', 'sorumluEposta', 'kova', 'proje'].map((k) => [k, { type: 'string' }])),
};
