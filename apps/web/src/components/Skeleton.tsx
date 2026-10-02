/** Placeholder blocks shown while a page's data loads. */
export function PageSkeleton({ blocks = [120, 220, 180] }: { blocks?: number[] }) {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="جارٍ التحميل">
      <span className="skeleton" style={{ width: 220, height: 34 }} />
      {blocks.map((h, i) => (
        <span key={i} className="skeleton" style={{ height: h }} />
      ))}
    </div>
  );
}
