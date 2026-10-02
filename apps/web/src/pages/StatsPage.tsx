import { addDays, cairoDay, formatDuration } from '@zenfocus/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { RequireAccount } from './RequireAccount';

const SHADES = ['var(--surface-2)', '#2f4a3e', '#4f7a66', '#72a38b', '#a5d2bc'];
const DAY_NAMES = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const TAG_COLORS = ['#8fbfa8', '#8fa8cf', '#e8b88a', '#b7a3d6', '#d9a0a0', '#a9c79a'];

function level(seconds: number) {
  if (!seconds) return 0;
  if (seconds < 3600) return 1;
  if (seconds < 2 * 3600) return 2;
  if (seconds < 3 * 3600) return 3;
  return 4;
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function Stats() {
  const q = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const s = q.data;
  if (!s) return null;

  const today = cairoDay(new Date());
  // 26 weeks of columns, each Saturday → Friday, ending with the current week.
  const sinceSat = (weekday(today) + 1) % 7;
  const start = addDays(today, -sinceSat - 25 * 7);
  const weeks = Array.from({ length: 26 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d))
  );
  const thisWeek = weeks[25]!;
  const maxDay = Math.max(3600, ...thisWeek.map((d) => s.days[d] ?? 0));
  const weekTotal = thisWeek.reduce((a, d) => a + (s.days[d] ?? 0), 0);
  const tagTotal = s.tags.reduce((a, t) => a + t.seconds, 0) || 1;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>إحصائياتي</h1>
          <p>كل جلسة خلصتها من أول ما سجلت، ومعاها جلسات الزائر اللي اتنقلت</p>
        </div>
      </header>

      {s.totalSeconds === 0 && (
        <section className="card empty-state" aria-label="لسه مفيش إحصائيات">
          <span className="empty-icon">
            <Icon name="chart" size={30} />
          </span>
          <h2>إحصائياتك هتبان هنا</h2>
          <p>كل جلسة تركيز بتكملها بتظهر هنا: أيامك، وأطول ستريك، ووقتك رايح على أنهي مادة. ابدأ أول جلسة دلوقتي.</p>
          <Link className="btn" to="/">
            ابدأ جلسة
          </Link>
        </section>
      )}

      <section className="kpis" aria-label="الأرقام">
        <div className="kpi">
          <span className="label">إجمالي التركيز</span>
          <span className="value">{formatDuration(s.totalSeconds)}</span>
        </div>
        <div className="kpi">
          <span className="label">المتوسط في الأيام اللي ذاكرت فيها</span>
          <span className="value">{formatDuration(s.dailyAverageSeconds)}</span>
        </div>
        <div className="kpi">
          <span className="label">أطول ستريك</span>
          <span className="value" style={{ color: 'var(--warm)' }}>
            {s.longestStreak}
            <small> يوم</small>
          </span>
          <span className="hint">الحالي: {s.currentStreak} يوم</span>
        </div>
        <div className="kpi">
          <span className="label">جلسات مكتملة</span>
          <span className="value">{s.sessions}</span>
        </div>
      </section>

      <section className="card" aria-label="أيام التركيز">
        <div className="card-head">
          <h2>أيام التركيز</h2>
          <div className="legend" aria-hidden="true">
            <span>أقل</span>
            {SHADES.map((c) => (
              <span key={c} className="heat-cell" style={{ background: c, width: 14, height: 14 }} />
            ))}
            <span>أكتر</span>
          </div>
        </div>
        <div className="heat" role="img" aria-label="خريطة ساعات التركيز لآخر 6 شهور">
          {[...weeks].reverse().map((week) => (
            <div className="heat-col" key={week[0]}>
              {week.map((day) => (
                <span
                  key={day}
                  className="heat-cell"
                  title={`${day}: ${formatDuration(s.days[day] ?? 0)}`}
                  style={{ background: day > today ? 'transparent' : SHADES[level(s.days[day] ?? 0)] }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card" aria-label="الأسبوع ده">
          <div className="card-head">
            <h2>الأسبوع ده</h2>
            <span className="num muted">{formatDuration(weekTotal)}</span>
          </div>
          <div className="bars">
            {thisWeek.map((day) => {
              const sec = s.days[day] ?? 0;
              return (
                <div className="col" key={day}>
                  <span className="num">{sec ? formatDuration(sec) : '—'}</span>
                  <div
                    className={`fill${day === today ? ' today' : ''}${sec ? '' : ' zero'}`}
                    style={{ height: `${Math.max(3, (sec / maxDay) * 140)}px` }}
                  />
                  <span>{DAY_NAMES[weekday(day)]}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card" aria-label="التوزيع">
          <div className="card-head">
            <h2>وقتك رايح فين</h2>
          </div>
          {s.tags.length === 0 && <p className="empty">لسه مفيش جلسات.</p>}
          {s.tags.map((t, i) => (
            <div className="tagrow" key={t.tag}>
              <div className="top">
                <span>{t.tag}</span>
                <span className="num muted">{formatDuration(t.seconds)}</span>
              </div>
              <div className="bar" style={{ height: 8 }}>
                <div style={{ width: `${(t.seconds / tagTotal) * 100}%`, background: TAG_COLORS[i % TAG_COLORS.length] }} />
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

export function StatsPage() {
  return (
    <RequireAccount what="الإحصائيات">
      <Stats />
    </RequireAccount>
  );
}
