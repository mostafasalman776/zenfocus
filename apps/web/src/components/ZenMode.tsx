import type { Task } from '@zenfocus/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTimer } from '../stores/timer';
import { Icon } from './Icon';

// Quotes carried over from the original ZenFocus.
const QUOTES = [
  { text: 'الهدوء هو مصدر القوة الحقيقي، والتركيز هو مفتاح الإنجاز.', author: 'حكمة قديمة' },
  { text: 'الأشياء العظيمة تُنجز بسلسلة من الأعمال الصغيرة المجموعة معاً.', author: 'فينسنت فان جوخ' },
  { text: 'كن هادئاً، فكل شيء سيمر في وقته المناسب.', author: 'مجهول' },
  { text: 'إنك لا تحتاج إلى رؤية السلالم بأكملها، فقط اتخذ الخطوة الأولى.', author: 'مارتن لوثر كينغ' },
  { text: 'البساطة هي قمة الفخامة والجمال.', author: 'ليوناردو دا فينشي' },
  { text: 'طريق الألف ميل يبدأ بخطوة واحدة.', author: 'لاوتسو' },
  { text: 'ركز على رحلتك، لا تقارن سرعتك بالآخرين.', author: 'نصيحة دافئة' },
  { text: 'التنفس بعمق هو تذكير بسيط بأنك هنا، والآن.', author: 'وعي ذاتي' }
];

const R = 148;
const C = 2 * Math.PI * R;
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Full-screen, distraction-free view of the running timer. */
export function ZenMode({ tasks, signedIn, onClose }: { tasks: Task[]; signedIn: boolean; onClose: () => void }) {
  const t = useTimer();
  const [quote, setQuote] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFade(true);
      setTimeout(() => {
        setQuote((q) => (q + 1) % QUOTES.length);
        setFade(false);
      }, 600);
    }, 45_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  const total = t.minutes[t.mode] * 60;
  const progress = total ? t.remaining / total : 0;
  const task = tasks.find((x) => x.id === t.taskId);
  const q = QUOTES[quote]!;

  // Portal to <body>: an ancestor with backdrop-filter would otherwise trap position: fixed.
  return createPortal(
    <div className="zen" role="dialog" aria-modal="true" aria-label="وضع التركيز الكامل">
      <button type="button" className="icon-btn zen-close" aria-label="خروج من وضع التركيز الكامل" onClick={onClose}>
        <Icon name="minimize" />
      </button>
      {task && t.mode === 'focus' && <span className="zen-task">المهمة: {task.title}</span>}
      <div className={`ring${t.mode === 'focus' ? '' : ' break'}${t.status === 'running' ? ' running' : ''}`}>
        <svg viewBox="0 0 320 320" aria-hidden="true">
          <circle className="track" cx="160" cy="160" r={R} fill="none" strokeWidth="6" />
          <circle className="progress" cx="160" cy="160" r={R} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        <div className="center">
          <span className="time" role="timer">
            {fmt(t.remaining)}
          </span>
          <span className="status">{t.mode === 'focus' ? 'وقت التركيز' : 'وقت الاستراحة'}</span>
        </div>
      </div>
      <div className="controls">
        {t.status === 'running' ? (
          <button type="button" className="round primary" aria-label="إيقاف مؤقت" onClick={() => void t.pause().catch(() => undefined)}>
            <Icon name="pause" size={30} />
          </button>
        ) : (
          <button
            type="button"
            className="round primary"
            aria-label={t.status === 'paused' ? 'استكمال' : 'ابدأ'}
            onClick={() => void (t.status === 'paused' ? t.resume() : t.start(signedIn)).catch(() => undefined)}
          >
            <Icon name="play" size={30} style={{ transform: 'scaleX(-1)' }} />
          </button>
        )}
      </div>
      <p className="zen-quote" style={{ opacity: fade ? 0 : 1 }}>
        «{q.text}»<b>{q.author}</b>
      </p>
    </div>,
    document.body
  );
}
