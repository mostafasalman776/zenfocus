import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Mobile bottom sheet. Closes on the backdrop or Escape. */
export function Sheet({ title, onClose, children, tall = false }: { title: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="sheet-layer">
      <button type="button" className="sheet-scrim" aria-label="إغلاق" onClick={onClose} />
      <section className={`sheet${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="sheet-handle" aria-label="إغلاق" onClick={onClose}>
          <span />
        </button>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}
