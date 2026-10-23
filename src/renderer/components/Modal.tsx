import { useEffect, type ReactNode } from 'react';

export function Modal({ title, sub, icon = 'ℹ', children, onClose, foot, wide }: { title: string; sub?: string; icon?: string; children: ReactNode; onClose: () => void; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back">
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <div className="icon">{icon}</div>
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="x" onClick={onClose} aria-label="Kapat">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}
