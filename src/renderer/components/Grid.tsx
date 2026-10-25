import { useMemo, useState, type ReactNode } from 'react';
import { cellText, COLUMNS, DELETED_COLS, type Col } from '../../shared/columns';
import { blankRow, isClosed, isOverdue, nextId } from '../../shared/model';
import type { AnyRow, Assignable, TableKey } from '../../shared/types';
import { useStore } from '../store';
import { badgeClass, DocCell, PersonCell, SelectCell, TextCell } from './Cells';
import { HistoryList } from './History';
import { Modal } from './Modal';

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
  const { project, addRows, removeRows, restoreRows, toast } = useStore();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [selLocal, setSelLocal] = useState<string[]>([]);
  const selected = selProp ?? selLocal;
  const setSelected = onSelect ?? setSelLocal;
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  const cols = [...COLUMNS[table].filter((c) => all || !c.secondary), ...(showDeleted ? DELETED_COLS : [])];
  const rows = project[table] as AnyRow[];
  const liveCount = rows.filter((r) => !r.deletedAt).length;
  const deletedCount = rows.length - liveCount;
  const selDeleted = selected.filter((id) => rows.find((r) => r.id === id)?.deletedAt);
  const selLive = selected.filter((id) => !selDeleted.includes(id));

  const visible = useMemo(() => {
    let out = rows.filter((r) => (showDeleted ? !!r.deletedAt : !r.deletedAt));
    if (filter) out = out.filter(filter);
    if (q.trim()) {
      const n = q.toLocaleLowerCase('tr');
      out = out.filter((r) => r.id.toLowerCase().includes(n) || COLUMNS[table].some((c) => cellText(c, r, project).toLocaleLowerCase('tr').includes(n)));
    }
    if (sort) {
      const col = COLUMNS[table].find((c) => c.key === sort.key)!;
      out = [...out].sort((a, b) => cellText(col, a, project).localeCompare(cellText(col, b, project), 'tr', { numeric: true }) * sort.dir);
    }
    return out;
  }, [rows, filter, q, sort, project, table, showDeleted]);

  const addRow = () => {
    const id = nextId(project, table);
    addRows(table, [blankRow(table, id)]);
    setTimeout(() => (document.querySelector(`[data-row="${id}"] .cell-input`) as HTMLElement | null)?.focus(), 50);
  };

  const remove = (reason: string) => {
    if (!deleting?.length) return;
    removeRows(table, deleting, reason);
    toast(`${deleting.length} kayıt silindi olarak işaretlendi. “Silinenler” görünümünden geri yüklenebilir.`);
    setDeleting(null);
    setSelected([]);
  };

  const restore = () => {
    restoreRows(table, selDeleted);
    toast(`${selDeleted.length} kayıt geri yüklendi`);
    setSelected([]);
  };

  return (
    <div className="grid-wrap">
      <div className="grid-toolbar">
        <button className="btn" onClick={addRow}>
          + Satır
        </button>
        {showDeleted ? (
          <button className="btn mint" disabled={!selDeleted.length} onClick={restore}>
            Geri yükle{selDeleted.length ? ` (${selDeleted.length})` : ''}
          </button>
        ) : (
          <button className="btn danger" disabled={!selLive.length} onClick={() => setDeleting(selLive)}>
            Sil{selLive.length ? ` (${selLive.length})` : ''}
          </button>
        )}
        <button className="btn" disabled={selected.length !== 1} title="Seçili kaydın değişiklik geçmişi" onClick={() => setHistoryOf(selected[0])}>
          Geçmiş
        </button>
        {toolbar && !showDeleted && <span className="sep" />}
        {!showDeleted && toolbar?.(selLive)}
        <span className="grow" />
        {filters}
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm kolonlar
        </label>
        {(deletedCount > 0 || showDeleted) && (
          <label className="check" title="Silinen kayıtlar dosyada kalır; buradan görülür ve geri yüklenir">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => {
                setShowDeleted(e.target.checked);
                setSelected([]);
              }}
            />{' '}
            Silinenler ({deletedCount})
          </label>
        )}
        <input className="search" placeholder="Ara…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted count">
          {visible.length}/{showDeleted ? deletedCount : liveCount}
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
                r.deletedAt ? 'deleted' : '',
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
        {liveCount === 0 && !showDeleted && <div className="empty">{emptyHint ?? 'Henüz kayıt yok. “+ Satır” ile başlayın.'}</div>}
      </div>
      {deleting && <DeleteDialog table={table} ids={deleting} onConfirm={remove} onClose={() => setDeleting(null)} />}
      {historyOf && (
        <Modal title={`${historyOf} değişiklik geçmişi`} sub="Bu kayıtta yapılan tüm değişiklikler, en yenisi üstte." icon="↺" wide onClose={() => setHistoryOf(null)}>
          <HistoryList rowId={historyOf} />
        </Modal>
      )}
    </div>
  );
}

/** Silme gerekçesi zorunlu: kayıt silinmez, gerekçesiyle birlikte silindi olarak işaretlenir. */
function DeleteDialog({ table, ids, onConfirm, onClose }: { table: TableKey; ids: string[]; onConfirm: (reason: string) => void; onClose: () => void }) {
  const { project } = useStore();
  const [reason, setReason] = useState('');
  const rows = (project[table] as AnyRow[]).filter((r) => ids.includes(r.id));
  const linked = rows.filter((r) => (r as Partial<Assignable>).plannerTaskId).length;
  return (
    <Modal
      title={`${ids.length} kayıt silinsin mi?`}
      sub={ids.join(', ')}
      icon="✕"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Sil
          </button>
        </>
      }
    >
      <p>Kayıt dosyada kalır, numarası başka bir kayda verilmez ve “Silinenler” görünümünden geri yüklenebilir. Silme işlemi değişiklik geçmişine yazılır.</p>
      {linked > 0 && <div className="callout">{linked} kayıt Planner görevine bağlı; Planner'daki görev silinmez.</div>}
      <div className="form" style={{ marginTop: 12 }}>
        <label className="wide">
          <span>Silme gerekçesi</span>
          <textarea className="cell-input" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. müşteri e-postası ile iptal edildi, mükerrer kayıt (REQ-004 ile aynı)" />
        </label>
      </div>
    </Modal>
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
    case 'doc':
      return <DocCell value={value} project={project} onCommit={commit} />;
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
