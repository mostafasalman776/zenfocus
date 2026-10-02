import type { Task, TimerMode } from '@zenfocus/shared';
import { useEffect, useState } from 'react';
import { loadPref, savePref } from '../lib/guest';
import { useWakeLock, wakeLockSupported } from '../lib/hooks';
import { MODE_LABEL, useTimer } from '../stores/timer';
import { Icon } from './Icon';
import { ZenMode } from './ZenMode';

const R = 148;
const C = 2 * Math.PI * R;

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimerCard({ tasks, signedIn }: { tasks: Task[]; signedIn: boolean }) {
  const t = useTimer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keepAwake, setKeepAwake] = useState(() => loadPref('keepAwake', false));
  const [zen, setZen] = useState(false);
  useWakeLock(t.status === 'running', keepAwake);

  // Show the countdown in the browser tab while it runs.
  useEffect(() => {
    const base = 'ZenFocus | مساحتك للتركيز';
    document.title = t.status === 'idle' ? base : `${fmt(t.remaining)} · ${MODE_LABEL[t.mode]}`;
    return () => {
      document.title = base;
    };
  }, [t.remaining, t.status, t.mode]);

  const total = t.minutes[t.mode] * 60;
  const progress = total ? t.remaining / total : 0;
  const openTasks = tasks.filter((x) => !x.done);
  const current = tasks.find((x) => x.id === t.taskId);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('معرفناش نوصل للسيرفر، جرّب تاني');
    } finally {
      setBusy(false);
    }
  };

  const status =
    t.status === 'paused'
      ? 'متوقف مؤقتاً'
      : t.mode === 'focus'
        ? t.status === 'running'
          ? `وقت التركيز · جلسة ${t.cycle + 1} من 4`
          : 'جاهز تبدأ؟'
        : 'وقت البريك، ريّح شوية';

  return (
    <section className="card timer" aria-label="التايمر">
      {zen && <ZenMode tasks={tasks} signedIn={signedIn} onClose={() => setZen(false)} />}
      <div className="timer-top">
        <button type="button" className="icon-btn" aria-label="وضع التركيز الكامل" title="وضع التركيز الكامل" onClick={() => setZen(true)}>
          <Icon name="maximize" size={18} />
        </button>
      </div>
      <div className="segmented" role="tablist" aria-label="نوع الجلسة">
        {(['focus', 'short', 'long'] as TimerMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={t.mode === m}
            disabled={t.status !== 'idle' && t.mode !== m}
            onClick={() => t.setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className={`ring${t.mode === 'focus' ? '' : ' break'}${t.status === 'running' ? ' running' : ''}`}>
        <svg viewBox="0 0 320 320" aria-hidden="true">
          <circle className="track" cx="160" cy="160" r={R} fill="none" strokeWidth="10" />
          <circle
            className="progress"
            cx="160"
            cy="160"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
          />
        </svg>
        <div className="center">
          <span className="time" role="timer" aria-live="off">
            {fmt(t.remaining)}
          </span>
          <span className="status">{status}</span>
        </div>
      </div>

      {t.mode === 'focus' && (
        <label className="current-task">
          <span className="muted">شغّال على:</span>
          <select
            value={t.taskId ?? ''}
            disabled={t.status !== 'idle'}
            onChange={(e) => t.setTask(e.target.value || null)}
          >
            <option value="">{current && current.done ? current.title : 'بدون مهمة'}</option>
            {openTasks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="controls">
        <button type="button" className="round" aria-label="إنهاء وإعادة" onClick={run(t.stop)} disabled={busy || t.status === 'idle'}>
          <Icon name={t.status === 'idle' ? 'reset' : 'stop'} size={22} />
        </button>
        {t.status === 'running' ? (
          <button type="button" className="round primary" aria-label="إيقاف مؤقت" onClick={run(t.pause)} disabled={busy}>
            <Icon name="pause" size={30} />
          </button>
        ) : (
          <button
            type="button"
            className="round primary"
            aria-label={t.status === 'paused' ? 'استكمال' : 'ابدأ'}
            onClick={run(t.status === 'paused' ? t.resume : () => t.start(signedIn))}
            disabled={busy}
          >
            <Icon name="play" size={30} style={{ transform: 'scaleX(-1)' }} />
          </button>
        )}
        <span style={{ width: 56 }} aria-hidden="true" />
      </div>

      <div className="dots" aria-label={`${t.cycle} من 4 جلسات قبل الراحة الطويلة`}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < t.cycle ? 'on' : ''} />
        ))}
        <span style={{ marginInlineStart: 6 }}>راحة طويلة كل 4 جلسات</span>
      </div>

      <div className="timer-foot">
        {wakeLockSupported && (
          <button
            type="button"
            className="toggle"
            aria-pressed={keepAwake}
            onClick={() => {
              setKeepAwake(!keepAwake);
              savePref('keepAwake', !keepAwake);
            }}
          >
            <span className="knob" />
            خلّي الشاشة صاحية
          </button>
        )}
        {!signedIn && t.mode === 'focus' && <span>الجلسات محفوظة على الجهاز ده بس</span>}
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>
          {error}
        </p>
      )}
    </section>
  );
}
