import { useMemo, useState } from 'react';
import { fieldLabel } from '../../shared/columns';
import { TABLE_LABEL } from '../../shared/model';
import type { ChangeEntry, TableKey } from '../../shared/types';
import { useStore } from '../store';

const LIMIT = 500;

const when = (at: string) => new Date(at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** Değişiklik günlüğü tablosu, en yenisi üstte. rowId verilirse yalnızca o kaydın geçmişi. */
export function HistoryList({ rowId, table, q = '' }: { rowId?: string; table?: TableKey | ''; q?: string }) {
  const { project } = useStore();
  const rows = useMemo(() => {
    const n = q.trim().toLocaleLowerCase('tr');
    const out: ChangeEntry[] = [];
    for (let i = project.history.length - 1; i >= 0; i--) {
      const h = project.history[i];
      if (rowId && h.rowId !== rowId) continue;
      if (table && h.table !== table) continue;
      if (n && ![h.rowId, h.user, h.action, fieldLabel(h.table, h.field), h.from, h.to].some((x) => x.toLocaleLowerCase('tr').includes(n))) continue;
      out.push(h);
    }
    return out;
  }, [project.history, rowId, table, q]);

  if (!rows.length) return <div className="empty">{project.history.length ? 'Filtreye uyan değişiklik yok.' : 'Henüz kayıtlı değişiklik yok. Bu sürümden itibaren her düzenleme buraya yazılır.'}</div>;
  return (
    <>
      <table className="history">
        <thead>
          <tr>
            <th>Zaman</th>
            <th>Kullanıcı</th>
            {!rowId && <th>Kayıt</th>}
            <th>İşlem</th>
            <th>Alan</th>
            <th>Eski değer</th>
            <th>Yeni değer</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, LIMIT).map((h, i) => (
            <tr key={i} className={`a-${h.action === 'Değişti' ? 'upd' : h.action === 'Silindi' ? 'del' : 'new'}`}>
              <td className="nowrap">{when(h.at)}</td>
              <td className="nowrap">{h.user}</td>
              {!rowId && (
                <td className="nowrap" title={TABLE_LABEL[h.table]}>
                  {h.rowId}
                </td>
              )}
              <td className="nowrap">{h.action}</td>
              <td>{fieldLabel(h.table, h.field)}</td>
              <td className="val old">{h.from}</td>
              <td className="val">{h.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMIT && <p className="muted">İlk {LIMIT} kayıt gösteriliyor ({rows.length} kayıt var). Tümü Excel raporundaki “Değişiklik Geçmişi” sayfasında.</p>}
    </>
  );
}
