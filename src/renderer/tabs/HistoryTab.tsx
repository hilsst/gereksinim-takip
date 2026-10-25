import { useState } from 'react';
import { TABLE_LABEL } from '../../shared/model';
import type { TableKey } from '../../shared/types';
import { HistoryList } from '../components/History';
import { useStore } from '../store';

export function HistoryTab() {
  const { project, user } = useStore();
  const [table, setTable] = useState<TableKey | ''>('');
  const [q, setQ] = useState('');
  return (
    <div className="grid-wrap">
      <div className="grid-toolbar">
        <span className="muted">
          Değişiklikler <b>{user || 'bilinmiyor'}</b> kullanıcı adıyla kaydediliyor. Planner'dan gelen kapanışlar “Teams Planner” olarak görünür.
        </span>
        <span className="grow" />
        <select className="filter" value={table} onChange={(e) => setTable(e.target.value as TableKey | '')}>
          <option value="">Tüm tablolar</option>
          {(Object.keys(TABLE_LABEL) as TableKey[]).map((t) => (
            <option key={t} value={t}>
              {TABLE_LABEL[t]}
            </option>
          ))}
        </select>
        <input className="search" placeholder="Kayıt, kullanıcı, alan veya değer ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted count">{project.history.length}</span>
      </div>
      <div className="grid-scroll">
        <HistoryList table={table} q={q} />
      </div>
    </div>
  );
}
