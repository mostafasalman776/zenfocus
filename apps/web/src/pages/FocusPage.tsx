import { formatDuration } from '@zenfocus/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { LoginButton } from '../components/Layout';
import { Sounds } from '../components/Sounds';
import { TaskList } from '../components/TaskList';
import { TimerCard } from '../components/TimerCard';
import { api } from '../lib/api';
import { useMe, useTasks } from '../lib/hooks';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'سهران بتذاكر';
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'يومك حلو';
  return 'مساء الخير';
}

export function FocusPage() {
  const { me } = useMe();
  const tasks = useTasks(me);
  const today = useQuery({ queryKey: ['today'], queryFn: api.today, enabled: Boolean(me), refetchInterval: 60_000 });
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
            {me ? ` يا ${me.name.split(' ')[0]}` : ''}
          </h1>
          <p>
            {new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
            {d && (left ? ` · فاضلك ${formatDuration(left)} على هدف النهارده` : ' · حققت هدف النهارده')}
          </p>
        </div>
        {d && d.streak > 0 && (
          <span className="chip">
            <Icon name="flame" size={18} />
            {d.streak} {d.streak === 1 ? 'يوم' : 'أيام'} ورا بعض
          </span>
        )}
      </header>

      {!me && (
        <div className="banner">
          <div className="text">
            <b>إنت داخل كزائر</b>
            <span className="muted" style={{ fontSize: 14 }}>
              التايمر والمهام شغالين ومتسجلين على الجهاز ده. سجّل عشان تحفظ ساعاتك وتدخل الغرف وتنافس صحابك، وكل
              اللي عملته هيتنقل معاك.
            </span>
          </div>
          <LoginButton />
        </div>
      )}

      <div className="focus-grid">
        <TimerCard tasks={tasks.tasks} signedIn={Boolean(me)} />
        <div className="stack">
          {me && d && (
            <section className="today-strip" aria-label="ملخص النهارده" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <div className="kpi">
                <span className="label">تركيز النهارده</span>
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
                  {done} من {tasks.tasks.length} مهام خلصت
                </span>
              </div>
              <Link className="kpi" to="/leaderboard" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="label">ترتيبك بين صحابك الأسبوع ده</span>
                  <span className="hint">{d.friendsCount ? 'شوف المنافسة' : 'ضيف صحابك عشان تنافسوا'}</span>
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
