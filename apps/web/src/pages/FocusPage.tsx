import { formatDuration } from '@zenfocus/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
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
  const { themeToggle } = useOutletContext<{ themeToggle: React.ReactNode }>();
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
        <div className="head-actions">
          {d && d.streak > 0 && (
            <span className="chip">
              <Icon name="flame" size={18} />
              {d.streak} {d.streak === 1 ? 'يوم' : 'أيام'} ورا بعض
            </span>
          )}
          <span className="desktop-only">{themeToggle}</span>
        </div>
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

      {me && d && (
        <section className="kpis focus-kpis" aria-label="ملخص النهارده">
          <div className="kpi">
            <span className="label">وقت التركيز النهارده</span>
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
            <span className="hint">النهارده</span>
          </div>
          <div className="kpi">
            <span className="label">مهام خلصت</span>
            <span className="value">
              {done}
              <small> / {tasks.tasks.length}</small>
            </span>
            <span className="hint">{tasks.tasks.length - done ? `فاضل ${tasks.tasks.length - done}` : 'مفيش حاجة فاضلة'}</span>
          </div>
          <Link className="kpi" to="/leaderboard">
            <span className="label">ترتيبك بين صحابك</span>
            <span className="value" style={{ color: 'var(--warm)' }}>
              {d.rank ? `#${d.rank}` : '—'}
            </span>
            <span className="hint">{d.friendsCount ? 'الأسبوع ده' : 'ضيف صحابك عشان تنافسوا'}</span>
          </Link>
        </section>
      )}

      <div className="cols">
        <TimerCard tasks={tasks.tasks} signedIn={Boolean(me)} />
        <div className="stack">
          <TaskList api={tasks} />
          <Sounds />
        </div>
      </div>
    </>
  );
}
