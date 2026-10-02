import { formatDuration } from '@zenfocus/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { DailyGarden, guestToday } from '../components/Garden';
import { Icon } from '../components/Icon';
import { LoginButton } from '../components/Layout';
import { Sheet } from '../components/Sheet';
import { Sounds, activeSoundLabel, useSoundStore } from '../components/Sounds';
import { TaskList } from '../components/TaskList';
import { TimerCard } from '../components/TimerCard';
import { api } from '../lib/api';
import { loadGuestSessions } from '../lib/guest';
import { useIsMobile, useMe, useTasks, wakeLockSupported } from '../lib/hooks';
import { useTimer } from '../stores/timer';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'مساء الخير';
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'مرحبًا';
  return 'مساء الخير';
}

/** Phone layout: everything on one screen; tasks and sounds open as sheets. */
function MobileFocus() {
  const { me } = useMe();
  const tasks = useTasks(me);
  const today = useQuery({ queryKey: ['today'], queryFn: api.today, enabled: Boolean(me), refetchInterval: 60_000 });
  const notice = useTimer((s) => s.notice);
  const keepAwake = useTimer((s) => s.keepAwake);
  const setKeepAwake = useTimer((s) => s.setKeepAwake);
  const [sheet, setSheet] = useState<'tasks' | 'sounds' | null>(null);
  const sound = activeSoundLabel(useSoundStore((s) => s.on));
  const d = today.data;
  // Guests: re-read local history after each finished session (notice changes).
  const guest = !me ? guestToday(loadGuestSessions()) : null;
  void notice;
  const open = tasks.tasks.filter((t) => !t.done).length;

  return (
    <div className="m-focus">
      <TimerCard tasks={tasks.tasks} signedIn={Boolean(me)} compact />
      <DailyGarden
        sessions={d?.sessions ?? guest?.sessions ?? 0}
        seconds={d?.seconds ?? guest?.seconds ?? 0}
        goalSeconds={d?.goalSeconds ?? 4 * 3600}
        rank={d?.friendsCount ? d.rank : null}
      />
      <div className="quick-row">
        <button type="button" className="quick" onClick={() => setSheet('tasks')}>
          <Icon name="list" size={20} />
          <span>المهام</span>
          <span className="num muted">
            {tasks.tasks.length - open}/{tasks.tasks.length}
          </span>
        </button>
        <button type="button" className="quick" onClick={() => setSheet('sounds')}>
          <Icon name="rain" size={20} />
          <span>الأصوات</span>
          <span className="muted">{sound ?? 'إيقاف'}</span>
        </button>
      </div>

      {sheet === 'tasks' && (
        <Sheet title="المهام" onClose={() => setSheet(null)} tall>
          <TaskList api={tasks} />
        </Sheet>
      )}
      {sheet === 'sounds' && (
        <Sheet title="الأصوات" onClose={() => setSheet(null)}>
          <Sounds />
          {wakeLockSupported && (
            <button type="button" className="toggle sheet-toggle" aria-pressed={keepAwake} onClick={() => setKeepAwake(!keepAwake)}>
              <span className="knob" />
              إبقاء الشاشة مضاءة أثناء الجلسة
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}

export function FocusPage() {
  const isMobile = useIsMobile();
  const { me } = useMe();
  const tasks = useTasks(me);
  const today = useQuery({ queryKey: ['today'], queryFn: api.today, enabled: Boolean(me), refetchInterval: 60_000 });
  if (isMobile) return <MobileFocus />;

  const d = today.data;
  const goalPct = d ? Math.min(100, Math.round((d.seconds / d.goalSeconds) * 100)) : 0;
  const left = d ? Math.max(0, d.goalSeconds - d.seconds) : 0;
  const done = tasks.tasks.filter((t) => t.done).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {greeting()}
            {me ? `، ${me.name.split(' ')[0]}` : ''}
          </h1>
          <p>
            {new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
            {d && (left ? ` · متبقٍ ${formatDuration(left)} على هدف اليوم` : ' · أنجزت هدف اليوم')}
          </p>
        </div>
        {d && d.streak > 0 && (
          <span className="chip">
            <Icon name="flame" size={18} />
            {d.streak} {d.streak === 1 ? 'يوم' : 'أيام'} متتالية
          </span>
        )}
      </header>

      {!me && (
        <div className="banner">
          <div className="text">
            <b>أنت تستخدم المنصة كزائر</b>
            <span className="muted" style={{ fontSize: 14 }}>
              سجّل الدخول لحفظ تقدمك واستخدام الغرف والمنافسة.
            </span>
          </div>
          <LoginButton />
        </div>
      )}

      <div className="focus-grid">
        <TimerCard tasks={tasks.tasks} signedIn={Boolean(me)} />
        <div className="stack">
          {me && d && (
            <section className="today-strip" aria-label="ملخص اليوم" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <div className="kpi">
                <span className="label">تركيز اليوم</span>
                <span className="value">{formatDuration(d.seconds)}</span>
                <div className="bar">
                  <div style={{ width: `${goalPct}%` }} />
                </div>
                <span className="hint">
                  {goalPct}% من هدف {formatDuration(d.goalSeconds)}
                </span>
              </div>
              <div className="kpi">
                <span className="label">جلسات مكتملة</span>
                <span className="value">{d.sessions}</span>
                <span className="hint">
                  {done} من {tasks.tasks.length} مهام منجزة
                </span>
              </div>
              <Link className="kpi" to="/leaderboard" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="label">ترتيبك هذا الأسبوع</span>
                  <span className="hint">{d.friendsCount ? 'عرض المنافسة' : 'أضف أصدقاءك'}</span>
                </span>
                <span className="value" style={{ color: 'var(--warm)' }}>
                  {d.rank && d.friendsCount ? `#${d.rank}` : <Icon name="trophy" size={24} />}
                </span>
              </Link>
            </section>
          )}
          <TaskList api={tasks} />
          <Sounds />
        </div>
      </div>
    </>
  );
}
