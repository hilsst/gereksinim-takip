// Değişiklik günlüğü: her düzenlemede önceki ve sonraki proje karşılaştırılır, alan bazında kayıt düşülür.
import { bumpSeq, ID_PREFIX } from './model';
import type { AnyRow, ChangeEntry, Project, TableKey } from './types';

/** Senkron ayrıntısı olan teknik alanlar günlüğe yazılmaz. */
const SKIP = new Set(['id', 'plannerEtag', 'plannerSyncedAt', 'aadId', 'deletedAt', 'deletedBy', 'deleteReason']);
const MAX = 2000;

const text = (v: unknown): string => {
  if (v == null) return '';
  const s = typeof v === 'boolean' ? (v ? 'Evet' : 'Hayır') : Array.isArray(v) ? v.join(', ') : String(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…` : s;
};

/** Oluşturma kaydında gösterilen kısa özet. */
export function rowTitle(r: AnyRow): string {
  const x = r as unknown as Record<string, unknown>;
  return text(x.text ?? x.description ?? x.name ?? '');
}

export function diffProjects(prev: Project, next: Project, user: string, at = new Date().toISOString()): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const table of Object.keys(ID_PREFIX) as TableKey[]) {
    const before = new Map((prev[table] as AnyRow[]).map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const row of next[table] as AnyRow[]) {
      seen.add(row.id);
      const old = before.get(row.id);
      const e = (action: ChangeEntry['action'], field = '', from = '', to = '') => out.push({ at, user, table, rowId: row.id, action, field, from, to });
      if (!old) {
        e('Oluşturuldu', '', '', rowTitle(row));
        continue;
      }
      if (old === row) continue;
      if (!old.deletedAt && row.deletedAt) e('Silindi', '', '', row.deleteReason);
      if (old.deletedAt && !row.deletedAt) e('Geri yüklendi', '', old.deleteReason, '');
      const a = old as unknown as Record<string, unknown>;
      const b = row as unknown as Record<string, unknown>;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (SKIP.has(k)) continue;
        const from = text(a[k]);
        const to = text(b[k]);
        if (from !== to) e('Değişti', k, from, to);
      }
    }
    // Kayıtlar normalde silinmez, işaretlenir; yine de dosyadan çıkan satır izsiz kalmasın
    for (const [id, old] of before) if (!seen.has(id)) out.push({ at, user, table, rowId: id, action: 'Silindi', field: '', from: rowTitle(old), to: 'Kayıt dosyadan çıkarıldı' });
  }
  return out;
}

/** Düzenlenmiş projeye günlük kayıtlarını ve numara sayacını işler. */
export function record(prev: Project, next: Project, user: string, at?: string): Project {
  const entries = diffProjects(prev, next, user, at);
  if (entries.length) next.history = [...next.history, ...entries];
  bumpSeq(next);
  return next;
}
