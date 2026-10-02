import { cairoDay, formatDuration, gardenSize } from '@zenfocus/shared';
import { Icon } from './Icon';

/** One leaf per completed focus session, up to the day's goal. */
export function DailyGarden({ sessions, goalSeconds, seconds, rank }: { sessions: number; goalSeconds: number; seconds: number; rank: number | null }) {
  const size = gardenSize(goalSeconds);
  const grown = Math.min(sessions, size);
  const extra = Math.max(0, sessions - size);
  return (
    <section className="card garden" aria-label={`حديقة اليوم: ${sessions} من ${size} جلسات`}>
      <div className="garden-head">
        <h2>حديقة اليوم</h2>
        <span className="muted num">
          {formatDuration(seconds)}
          {rank ? ` · ترتيبك #${rank}` : ''}
        </span>
      </div>
      <div className="leaves">
        {Array.from({ length: size }, (_, i) => (
          <span key={i} className={`leaf${i < grown ? ' grown' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
            <Icon name="leaf" size={18} />
          </span>
        ))}
        {extra > 0 && <span className="leaf-extra num">+{extra}</span>}
      </div>
    </section>
  );
}

/** Guests: count today's completed sessions recorded on this device. */
export function guestToday(sessions: { startedAt: string; seconds: number; completed: boolean }[]) {
  const today = cairoDay(new Date());
  const mine = sessions.filter((s) => cairoDay(new Date(s.startedAt)) === today);
  return { sessions: mine.filter((s) => s.completed).length, seconds: mine.reduce((a, s) => a + s.seconds, 0) };
}
