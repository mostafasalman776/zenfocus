import { formatDuration, type AdminOverview } from '@zenfocus/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Avatar } from '../components/Icon';
import { PageSkeleton } from '../components/Skeleton';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';

type Tab = 'overview' | 'users' | 'rooms' | 'reports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'نظرة عامة' },
  { id: 'users', label: 'المستخدمون' },
  { id: 'rooms', label: 'الغرف' },
  { id: 'reports', label: 'البلاغات' }
];

const nf = new Intl.NumberFormat('en-US');
const n = (v: number) => nf.format(v);

function bytes(v: number) {
  if (v < 1024 * 1024) return `${n(Math.round(v / 1024))} ك.ب`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} م.ب`;
  return `${(v / 1024 ** 3).toFixed(2)} ج.ب`;
}

function ago(iso: string | null) {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'الآن';
  if (min < 60) return `منذ ${n(min)} دقيقة`;
  const h = Math.round(min / 60);
  if (h < 24) return `منذ ${n(h)} ساعة`;
  return `منذ ${n(Math.round(h / 24))} يوم`;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });

export function AdminPage() {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('overview');
  if (!me?.isAdmin) return <p className="empty">هذه الصفحة للمشرفين فقط.</p>;
  return (
    <div className="admin">
      <header className="page-head">
        <div>
          <h1>لوحة التحكم</h1>
        </div>
        <div className="segmented" role="tablist" aria-label="أقسام لوحة التحكم">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'rooms' && <Rooms />}
      {tab === 'reports' && <Reports />}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.adminOverview, refetchInterval: 30_000 });
  const o = q.data;
  if (!o) return <PageSkeleton blocks={[110, 110, 240]} />;
  const saved = o.images.originalBytes - o.images.bytes;
  return (
    <>
      <section className="kpis" aria-label="المستخدمون">
        <Kpi label="إجمالي المستخدمين" value={n(o.users.total)} hint={`${n(o.users.new7d)} جديد هذا الأسبوع`} />
        <Kpi label="متصل الآن" value={n(o.activity.onlineNow)} hint={`${n(o.activity.focusingNow)} يركّزون الآن`} />
        <Kpi label="نشط اليوم" value={n(o.activity.activeToday)} hint={`${n(o.activity.active7d)} في 7 أيام · ${n(o.activity.active30d)} في 30 يومًا`} />
        <Kpi label="جديد اليوم" value={n(o.users.new1d)} hint={`${n(o.users.new30d)} في 30 يومًا`} />
      </section>
      <section className="kpis" aria-label="النشاط">
        <Kpi label="إجمالي التركيز" value={formatDuration(o.focus.totalSeconds)} hint={`اليوم: ${formatDuration(o.focus.todaySeconds)}`} />
        <Kpi label="جلسات مكتملة" value={n(o.focus.sessions)} />
        <Kpi label="الغرف" value={n(o.rooms.total)} hint={`${n(o.rooms.messages)} رسالة · ${n(o.rooms.messagesToday)} اليوم`} />
        <Kpi
          label="مساحة الصور"
          value={bytes(o.images.bytes)}
          hint={`${n(o.images.count)} صورة · وفّر الضغط ${bytes(Math.max(0, saved))}`}
        />
      </section>
      <DailyChart daily={o.daily} />
      {(o.openReports > 0 || o.users.banned > 0) && (
        <p className="muted admin-note">
          {o.openReports > 0 && `${n(o.openReports)} بلاغ مفتوح. `}
          {o.users.banned > 0 && `${n(o.users.banned)} مستخدم محظور.`}
        </p>
      )}
    </>
  );
}

function DailyChart({ daily }: { daily: AdminOverview['daily'] }) {
  const [metric, setMetric] = useState<'activeUsers' | 'signups' | 'focusSeconds'>('activeUsers');
  const max = Math.max(1, ...daily.map((d) => d[metric]));
  const fmt = (v: number) => (metric === 'focusSeconds' ? formatDuration(v) : n(v));
  return (
    <section className="card" aria-label="آخر 30 يومًا">
      <div className="card-head">
        <h2>آخر 30 يومًا</h2>
        <div className="segmented" role="tablist" aria-label="المؤشر">
          {(
            [
              ['activeUsers', 'النشطون'],
              ['signups', 'التسجيلات'],
              ['focusSeconds', 'التركيز']
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={metric === id} onClick={() => setMetric(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-chart" role="img" aria-label="رسم بياني يومي">
        {daily.map((d) => (
          <span
            key={d.day}
            className="admin-bar"
            style={{ height: `${Math.max(2, (d[metric] / max) * 100)}%` }}
            title={`${d.day}: ${fmt(d[metric])}`}
          />
        ))}
      </div>
    </section>
  );
}

function Users() {
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);
  const q = useQuery({ queryKey: ['admin', 'users', query, offset], queryFn: () => api.adminUsers(query, offset) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  return (
    <section className="card admin-list" aria-label="المستخدمون">
      <div className="card-head">
        <h2>
          المستخدمون {q.data && <span className="muted">({n(q.data.total)})</span>}
        </h2>
        <input
          className="input admin-search"
          type="search"
          placeholder="بحث بالاسم أو المعرّف أو البريد"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      {q.data?.users.length === 0 && <p className="empty">لا يوجد مستخدمون.</p>}
      <ul className="admin-rows">
        {q.data?.users.map((u) => (
          <li key={u.id} className={u.bannedAt ? 'banned' : undefined}>
            <Avatar name={u.name} src={u.avatarUrl} id={u.id} size={38} />
            <div className="admin-who">
              <b>
                {u.name}
                {u.isAdmin && <span className="pill">مشرف</span>}
                {u.bannedAt && <span className="pill danger">محظور</span>}
              </b>
              <span className="muted">
                {u.username ? `@${u.username}` : 'بدون معرّف'} · {u.email ?? '—'}
              </span>
            </div>
            <div className="admin-meta">
              <span>{formatDuration(u.totalSeconds)}</span>
              <span className="muted">
                {n(u.sessions)} جلسة · آخر نشاط {ago(u.lastActiveAt)} · انضم {date(u.createdAt)}
              </span>
            </div>
            {!u.isAdmin && (
              <div className="admin-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    if (u.bannedAt || window.confirm(`حظر ${u.name}؟ سيتم تسجيل خروجه فورًا.`))
                      void api.adminBan(u.id, !u.bannedAt).then(refresh);
                  }}
                >
                  {u.bannedAt ? 'رفع الحظر' : 'حظر'}
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm(`حذف حساب ${u.name} وكل بياناته نهائيًا؟`)) void api.adminDeleteUser(u.id).then(refresh);
                  }}
                >
                  حذف
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {q.data && q.data.total > 50 && (
        <div className="admin-pager">
          <button type="button" className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            السابق
          </button>
          <span className="muted">
            {n(offset + 1)}–{n(Math.min(offset + 50, q.data.total))} من {n(q.data.total)}
          </span>
          <button type="button" className="btn ghost" disabled={offset + 50 >= q.data.total} onClick={() => setOffset(offset + 50)}>
            التالي
          </button>
        </div>
      )}
    </section>
  );
}

function Rooms() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'rooms'], queryFn: api.adminRooms, refetchInterval: 30_000 });
  return (
    <section className="card admin-list" aria-label="الغرف">
      <div className="card-head">
        <h2>
          الغرف {q.data && <span className="muted">({n(q.data.rooms.length)})</span>}
        </h2>
      </div>
      {q.data?.rooms.length === 0 && <p className="empty">لا توجد غرف.</p>}
      <ul className="admin-rows">
        {q.data?.rooms.map((r) => (
          <li key={r.id}>
            <div className="admin-who">
              <b>
                {r.name}
                {r.liveNow > 0 && <span className="pill live">{n(r.liveNow)} الآن</span>}
              </b>
              <span className="muted">المالك: {r.ownerName}</span>
            </div>
            <div className="admin-meta">
              <span>{n(r.members)} أعضاء</span>
              <span className="muted">
                {n(r.messages)} رسالة · أُنشئت {date(r.createdAt)}
              </span>
            </div>
            <div className="admin-actions">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (window.confirm(`حذف غرفة «${r.name}» ومحادثتها وصورها؟`))
                    void api.adminDeleteRoom(r.id).then(() => qc.invalidateQueries({ queryKey: ['admin'] }));
                }}
              >
                حذف
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reports() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reports'], queryFn: api.reports });
  const resolve = (id: string, del: boolean) =>
    api.resolveReport(id, del).then(() => qc.invalidateQueries({ queryKey: ['reports'] }));
  return (
    <>
      {q.data?.reports.length === 0 && <p className="empty">لا توجد بلاغات.</p>}
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
              <p>{r.message.deleted ? 'محذوفة' : r.message.body}</p>
            </>
          ) : (
            <p className="muted">الرسالة غير موجودة</p>
          )}
          <div className="head-actions">
            <button type="button" className="btn danger" onClick={() => resolve(r.id, true)}>
              حذف الرسالة
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
