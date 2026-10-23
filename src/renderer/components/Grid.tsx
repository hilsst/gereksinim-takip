import { useMemo, useState, type ReactNode } from 'react';
import { cellText, COLUMNS, type Col } from '../../shared/columns';
import { blankRow, isClosed, isOverdue, nextId } from '../../shared/model';
import type { AnyRow, Assignable, TableKey } from '../../shared/types';
import { useStore } from '../store';
import { badgeClass, PersonCell, SelectCell, TextCell } from './Cells';

interface GridProps {
  table: TableKey;
  toolbar?: (selected: string[]) => ReactNode;
  filters?: ReactNode;
  filter?: (r: AnyRow) => boolean;
  emptyHint?: ReactNode;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
}

export function Grid({ table, toolbar, filters, filter, emptyHint, selected: selProp, onSelect }: GridProps) {
  const { project, addRows, removeRows, toast } = useStore();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [selLocal, setSelLocal] = useState<string[]>([]);
  const selected = selProp ?? selLocal;
  const setSelected = onSelect ?? setSelLocal;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const cols = COLUMNS[table].filter((c) => all || !c.secondary);
  const rows = project[table] as AnyRow[];

  const visible = useMemo(() => {
    let out = filter ? rows.filter(filter) : rows;
    if (q.trim()) {
      const n = q.toLocaleLowerCase('tr');
      out = out.filter((r) => r.id.toLowerCase().includes(n) || COLUMNS[table].some((c) => cellText(c, r, project).toLocaleLowerCase('tr').includes(n)));
    }
    if (sort) {
      const col = COLUMNS[table].find((c) => c.key === sort.key)!;
      out = [...out].sort((a, b) => cellText(col, a, project).localeCompare(cellText(col, b, project), 'tr', { numeric: true }) * sort.dir);
    }
    return out;
  }, [rows, filter, q, sort, project, table]);

  const addRow = () => {
    const id = nextId(project, table);
    addRows(table, [blankRow(table, id)]);
    setTimeout(() => (document.querySelector(`[data-row="${id}"] .cell-input`) as HTMLElement | null)?.focus(), 50);
  };

  const remove = () => {
    if (!selected.length) return;
    const linked = selected.filter((id) => (rows.find((r) => r.id === id) as Partial<Assignable>)?.plannerTaskId);
    const warn = linked.length ? `\n\n${linked.length} satır Planner görevine bağlı; Planner'daki görev silinmez.` : '';
    if (!window.confirm(`${selected.length} satır silinsin mi?\n${selected.join(', ')}${warn}`)) return;
    removeRows(table, selected);
    toast(`${selected.length} satır silindi`);
    setSelected([]);
  };

  return (
    <div className="grid-wrap">
      <div className="grid-toolbar">
        <button className="btn" onClick={addRow}>
          + Satır
        </button>
        <button className="btn danger" disabled={!selected.length} onClick={remove}>
          Sil{selected.length ? ` (${selected.length})` : ''}
        </button>
        {toolbar && <span className="sep" />}
        {toolbar?.(selected)}
        <span className="grow" />
        {filters}
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm kolonlar
        </label>
        <input className="search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted count">
          {visible.length}/{rows.length}
        </span>
      </div>
      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="sticky-col sel">
                <input type="checkbox" checked={visible.length > 0 && visible.every((r) => selected.includes(r.id))} onChange={(e) => setSelected(e.target.checked ? visible.map((r) => r.id) : [])} />
              </th>
              <th className="sticky-col id">ID</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={{ minWidth: c.width, width: c.width }}
                  title={c.help}
                  className={c.type === 'computed' ? 'computed' : ''}
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                >
                  {c.label}
                  {c.help && <span className="info">ⓘ</span>}
                  {sort?.key === c.key && <span className="sort">{sort.dir === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const a = r as Partial<Assignable>;
              const cls = [
                selected.includes(r.id) ? 'selected' : '',
                a.workStatus && isOverdue(a as Assignable) ? 'late' : '',
                a.workStatus === 'Kapandı' ? 'done' : '',
                a.workStatus && isClosed(a as Assignable) ? 'closed' : '',
              ].join(' ');
              return (
                <tr key={r.id} data-row={r.id} className={cls}>
                  <td className="sticky-col sel">
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
                  </td>
                  <td className="sticky-col id">{r.id}</td>
                  {cols.map((c) => (
                    <td key={c.key} className={`t-${c.type} c-${c.key}`}>
                      <Cell col={c} row={r} table={table} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{emptyHint ?? 'Henüz kayıt yok. “+ Satır” ile başlayın.'}</div>}
      </div>
    </div>
  );
}

function Cell({ col, row, table }: { col: Col; row: AnyRow; table: TableKey }) {
  const { project, setField } = useStore();
  const value = (row as unknown as Record<string, unknown>)[col.key];
  const commit = (v: unknown) => setField(table, row.id, col.key, v);
  switch (col.type) {
    case 'computed': {
      const text = cellText(col, row, project);
      const b = badgeClass(col.key, text);
      return <div className="cell-ro center">{text && (b ? <span className={`badge ${b}`}>{text}</span> : text)}</div>;
    }
    case 'select':
      return <SelectCell field={col.key} value={value} options={col.options ?? []} readonly={col.readonly} onCommit={commit} />;
    case 'person':
      return <PersonCell value={value} discipline={(row as Partial<Assignable>).discipline} project={project} onCommit={commit} />;
    case 'bool':
      return (
        <div className="center">
          <input type="checkbox" checked={!!value} onChange={(e) => commit(e.target.checked)} />
        </div>
      );
    case 'long':
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} multiline />;
    case 'date':
      return <TextCell value={value} readonly={col.readonly} onCommit={commit} type="date" />;
    default:
      return <TextCell value={col.key === 'closedAt' && value ? String(value).slice(0, 10) : value} readonly={col.readonly} onCommit={commit} />;
  }
}
