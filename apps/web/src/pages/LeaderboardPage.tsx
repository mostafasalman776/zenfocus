import { formatDuration, type LeaderboardPeriod, type LeaderboardRow } from '@zenfocus/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar, Icon } from '../components/Icon';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { RequireAccount } from './RequireAccount';

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'الأسبوع ده' },
  { id: 'month', label: 'الشهر' },
  { id: 'all', label: 'كل الوقت' }
];

function Place({ row, rank }: { row: LeaderboardRow; rank: number }) {
  return (
    <div className={`place${rank === 1 ? ' first' : ''}`}>
      {rank === 1 ? <Icon name="trophy" size={24} label="المركز الأول" style={{ color: 'var(--warm)' }} /> : <span className="rank">#{rank}</span>}
      <Avatar name={row.name} src={row.avatarUrl} id={row.userId} size={rank === 1 ? 68 : 56} />
      <b>{row.isMe ? 'أنت' : row.name}</b>
      <span className="hours">{formatDuration(row.seconds)}</span>
      <span className="muted" style={{ fontSize: 12 }}>
        {row.sessions} جلسة{row.streak ? ` · ${row.streak} يوم ستريك` : ''}
      </span>
    </div>
  );
}

function Friends() {
  const qc = useQueryClient();
  const { me } = useMe();
  const friends = useQuery({ queryKey: ['friends'], queryFn: api.friends });
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['friends'] });
    void qc.invalidateQueries({ queryKey: ['leaderboard'] });
  };
  const request = useMutation({
    mutationFn: api.requestFriend,
    onSuccess: (r) => {
      setUsername('');
      setMsg(r.status === 'requested' ? 'اتبعت الطلب' : r.status === 'friends' ? 'بقيتوا أصحاب' : 'إنتوا أصحاب أصلاً');
      refresh();
    },
    onError: (e) => setMsg(e instanceof ApiError && e.status === 404 ? 'مفيش حد بالاسم ده' : 'حصلت مشكلة، جرّب تاني')
  });
  const inviteUrl = me ? `${location.origin}/invite/${me.inviteCode}` : '';

  return (
    <div className="side-cards">
      <section className="card" aria-label="ضيف صاحب">
        <div className="card-head">
          <h2>ضيف صحابك</h2>
        </div>
        <form
          className="task-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) request.mutate(username.trim());
          }}
        >
          <label htmlFor="friend-username" className="sr-only">
            اسم المستخدم
          </label>
          <div className="prefix" style={{ flexGrow: 1 }}>
            <span>@</span>
            <input
              id="friend-username"
              className="input"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <button type="submit" className="btn" disabled={request.isPending}>
            إضافة
          </button>
        </form>
        {msg && (
          <p role="status" className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            {msg}
          </p>
        )}
        <p className="muted" style={{ fontSize: 13, margin: '6px 0 8px' }}>
          أو ابعت اللينك ده، واللي يسجل منه يبقى صاحبك على طول
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="code">{me?.inviteCode}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <Icon name="copy" size={18} />
            {copied ? 'اتنسخ' : 'نسخ اللينك'}
          </button>
        </div>
      </section>

      {Boolean(friends.data?.incoming.length) && (
        <section className="card" aria-label="طلبات الصداقة">
          <div className="card-head">
            <h2>طلبات جاية</h2>
          </div>
          {friends.data!.incoming.map((f) => (
            <div className="person" key={f.requestId}>
              <Avatar name={f.name} src={f.avatarUrl} id={f.userId} size={36} />
              <div className="grow">
                <b>{f.name}</b>
                <span dir="ltr">@{f.username}</span>
              </div>
              <button type="button" className="btn sm" onClick={() => api.acceptFriend(f.requestId).then(refresh)}>
                قبول
              </button>
              <button type="button" className="btn sm ghost" onClick={() => api.dropRequest(f.requestId).then(refresh)}>
                رفض
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-label="أصحابي">
        <div className="card-head">
          <h2>أصحابي</h2>
          <span className="num muted">{friends.data?.friends.length ?? 0}</span>
        </div>
        {friends.data?.friends.length ? (
          friends.data.friends.map((f) => (
            <div className="person" key={f.userId}>
              <Avatar name={f.name} src={f.avatarUrl} id={f.userId} size={36} />
              <div className="grow">
                <b>{f.name}</b>
                <span dir="ltr">@{f.username}</span>
              </div>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => window.confirm(`تشيل ${f.name} من أصحابك؟`) && api.unfriend(f.userId).then(refresh)}
              >
                إزالة
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={() => window.confirm(`تعمل بلوك لـ ${f.name}؟ مش هيقدر يبعتلك طلبات تاني.`) && api.block(f.userId).then(refresh)}
              >
                بلوك
              </button>
            </div>
          ))
        ) : (
          <p className="empty">لسه مفيش أصحاب. ابعت لينك الدعوة لصحابك.</p>
        )}
        {Boolean(friends.data?.outgoing.length) && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            مستني رد: {friends.data!.outgoing.map((f) => `@${f.username}`).join('، ')}
          </p>
        )}
      </section>
    </div>
  );
}

function Board() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const q = useQuery({ queryKey: ['leaderboard', period], queryFn: () => api.leaderboard(period) });
  const rows = q.data?.rows ?? [];
  const myIdx = rows.findIndex((r) => r.isMe);
  const ahead = myIdx > 0 ? rows[myIdx - 1] : null;
  const gap = ahead ? ahead.seconds - rows[myIdx]!.seconds : 0;
  const [first, second, third] = rows;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>المنافسة</h1>
          <p>الترتيب بساعات التركيز الحقيقية من التايمر · الأسبوع بيبدأ السبت</p>
        </div>
        <div className="segmented" role="tablist" aria-label="الفترة">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={period === p.id} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="lb-cols">
        <div className="stack">
          {q.isSuccess && rows.length <= 1 && (
            <section className="card empty-state" aria-label="ابدأ المنافسة">
              <span className="empty-icon">
                <Icon name="trophy" size={30} />
              </span>
              <h2>المنافسة أحلى مع صحابك</h2>
              <p>ابعت لينك الدعوة اللي على الجنب لصحابك. أول ما حد يسجل منه هتلاقوا نفسكم في نفس الترتيب، وكل دقيقة تركيز بتفرق.</p>
            </section>
          )}
          {rows.length > 1 && (
            <section className="podium" aria-label="الأوائل">
              {second ? <Place row={second} rank={2} /> : <div />}
              {first && <Place row={first} rank={1} />}
              {third ? <Place row={third} rank={3} /> : <div />}
            </section>
          )}
          {myIdx >= 0 && rows.length > 1 && (
            <section className="card" aria-label="ترتيبك" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span className="num" style={{ fontSize: 40, color: 'var(--accent)' }}>
                #{myIdx + 1}
              </span>
              <span style={{ flex: '1 1 200px' }}>
                {ahead ? (
                  <>
                    محتاج <b style={{ color: 'var(--warm)' }}>{formatDuration(gap + 60)}</b> كمان وتعدّي {ahead.name}.
                  </>
                ) : rows.length > 1 ? (
                  'إنت الأول. حافظ على مكانك.'
                ) : (
                  'ضيف صحابك عشان المنافسة تبدأ.'
                )}
              </span>
              <Link className="btn" to="/">
                ابدأ جلسة
              </Link>
            </section>
          )}
          {rows.length > 1 && (
          <section className="card board" aria-label="الترتيب">
            <div className="board-row head">
              <span>#</span>
              <span>الاسم</span>
              <span>ساعات التركيز</span>
              <span className="opt">الجلسات</span>
              <span className="opt">الستريك</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.userId} className={`board-row${r.isMe ? ' me' : ''}`}>
                <span className="num muted">{i + 1}</span>
                <span className="who">
                  <Avatar name={r.name} src={r.avatarUrl} id={r.userId} size={34} />
                  <span>{r.isMe ? `${r.name} (أنت)` : r.name}</span>
                </span>
                <span className="num">{formatDuration(r.seconds)}</span>
                <span className="num opt muted">{r.sessions}</span>
                <span className="opt" style={{ color: 'var(--warm)', fontSize: 13 }}>
                  {r.streak ? `${r.streak} يوم` : '—'}
                </span>
              </div>
            ))}
          </section>
          )}
        </div>
        <Friends />
      </div>
    </>
  );
}

export function LeaderboardPage() {
  return (
    <RequireAccount what="المنافسة مع صحابك">
      <Board />
    </RequireAccount>
  );
}
