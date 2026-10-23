import { useEffect, useRef, useState } from 'react';
import { activePeople } from '../../shared/model';
import type { Project } from '../../shared/types';

export function TextCell({ value, readonly, onCommit, multiline, type = 'text' }: { value: unknown; readonly?: boolean; onCommit: (v: unknown) => void; multiline?: boolean; type?: string }) {
  const initial = value == null ? '' : String(value);
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(initial), [initial]);
  useEffect(() => {
    if (multiline && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 180)}px`;
    }
  }, [v, multiline]);
  const commit = () => {
    if (v !== initial) onCommit(v);
  };
  if (readonly) return <div className={`cell-ro ${multiline ? 'multi' : ''}`}>{initial}</div>;
  if (multiline)
    return (
      <textarea
        ref={ref}
        className="cell-input"
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setV(initial);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
        }}
      />
    );
  return (
    <input
      className="cell-input"
      type={type === 'date' ? 'date' : 'text'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(initial);
      }}
    />
  );
}

export function SelectCell({ field, value, options, readonly, onCommit }: { field: string; value: unknown; options: string[]; readonly?: boolean; onCommit: (v: unknown) => void }) {
  const v = value == null ? '' : String(value);
  if (readonly) return <div className="cell-ro">{v}</div>;
  return (
    <select className={`cell-select ${badgeClass(field, v)}`} value={v} onChange={(e) => onCommit(e.target.value)}>
      <option value=""></option>
      {!options.includes(v) && v && <option value={v}>{v}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Sorumlu seçimi: satırın disiplinindeki aktif kişiler önce, diğerleri ayrı grupta. */
export function PersonCell({ value, discipline, project, onCommit }: { value: unknown; discipline?: string; project: Project; onCommit: (v: unknown) => void }) {
  const v = value == null ? '' : String(value);
  const match = activePeople(project, discipline || undefined);
  const rest = project.people.filter((x) => x.active && !match.includes(x));
  return (
    <select className="cell-select" value={v} onChange={(e) => onCommit(e.target.value)}>
      <option value="">{project.people.length ? '' : '(Ekip sekmesine kişi ekleyin)'}</option>
      {v && !project.people.some((x) => x.id === v) && <option value={v}>{v} (bulunamadı)</option>}
      {match.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name || x.id}
          {x.discipline ? ` · ${x.discipline}` : ''}
        </option>
      ))}
      {rest.length > 0 && (
        <optgroup label="Diğer disiplinler">
          {rest.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name || x.id} · {x.discipline}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export function badgeClass(key: string, text: string): string {
  if (!text) return '';
  if (key === 'workStatus') return text === 'Kapandı' ? 'b-mint' : text === 'İptal' ? 'b-gray' : text === 'Atanmadı' ? 'b-butter' : text === 'Devam ediyor' ? 'b-lav' : 'b-sky';
  if (key === 'approval' || key === 'status') {
    if (text === 'Approved' || text === 'Closed' || text === 'Resolved') return 'b-mint';
    if (text === 'Rejected') return 'b-gray';
    if (text === 'AI Proposed') return 'b-butter';
    return 'b-sky';
  }
  if (key === 'priority') return text === 'Critical' ? 'b-rose' : text === 'Important' ? 'b-peach' : 'b-gray';
  if (key === 'discipline') return text === 'Tasarım' ? 'b-lav' : text === 'Konfigürasyon' ? 'b-sky' : 'b-peach';
  if (key === 'late') return 'b-rose';
  if (key === 'planner') return text === 'Kuyrukta' ? 'b-butter' : 'b-mint';
  if (key === 'linked') return 'b-mint';
  if (key === 'dataStatus' && text.startsWith('VERİ YOK')) return 'b-butter';
  if (key === 'evidenceType') return 'b-lav';
  return '';
}
