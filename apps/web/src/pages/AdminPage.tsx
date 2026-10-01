import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';

export function AdminPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reports'], queryFn: api.reports, enabled: Boolean(me?.isAdmin) });
  if (!me?.isAdmin) return <p className="empty">الصفحة دي للأدمن بس.</p>;
  const resolve = (id: string, del: boolean) =>
    api.resolveReport(id, del).then(() => qc.invalidateQueries({ queryKey: ['reports'] }));
  return (
    <>
      <header className="page-head">
        <div>
          <h1>البلاغات</h1>
          <p>رسايل وصور اتبلّغ عنها ولسه متراجعتش</p>
        </div>
      </header>
      {q.data?.reports.length === 0 && <p className="empty">مفيش بلاغات.</p>}
      {q.data?.reports.map((r) => (
        <section key={r.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {new Date(r.createdAt).toLocaleString('ar-EG')} · السبب: {r.reason || '—'}
          </span>
          {r.message ? (
            <>
              <b>{r.message.user?.name ?? 'مستخدم محذوف'}</b>
              {r.message.image && (
                <img src={r.message.image.url} alt="الصورة المبلّغ عنها" style={{ maxWidth: 320, borderRadius: 12 }} />
              )}
              <p>{r.message.deleted ? 'اتمسحت' : r.message.body}</p>
            </>
          ) : (
            <p className="muted">الرسالة مش موجودة</p>
          )}
          <div className="head-actions">
            <button type="button" className="btn danger" onClick={() => resolve(r.id, true)}>
              امسح الرسالة
            </button>
            <button type="button" className="btn ghost" onClick={() => resolve(r.id, false)}>
              تجاهل
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
