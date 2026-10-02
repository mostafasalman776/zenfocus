import { roomPhase, type PresenceStatus, type RoomDetail } from '@zenfocus/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/hooks';
import { Avatar, Icon, type IconName } from './Icon';

export type CheerKind = 'star' | 'heart' | 'flame';
export interface CheerBurst {
  id: number;
  userId: string;
  kind: CheerKind;
}

const STATUS_LABEL: Record<PresenceStatus, string> = {
  focus: 'يركّز',
  paused: 'متوقف مؤقتًا',
  online: 'متصل',
  offline: 'غير متصل'
};

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Members seated around the shared room timer. */
export function StudyTable({ room, meId, bursts, follow, setFollow }: {
  room: RoomDetail;
  meId: string;
  bursts: CheerBurst[];
  follow: boolean;
  setFollow: (v: boolean) => void;
}) {
  const now = useNow();
  const p = roomPhase(room.timer, now);
  const progress = 1 - p.remaining / p.length;
  const R = 46;
  const C = 2 * Math.PI * R;
  const seats = room.members.slice(0, 12);
  const owner = room.role === 'owner';
  const act = (a: 'start' | 'pause' | 'reset' | 'skip') => () => void api.roomTimer(room.id, a);

  return (
    <section className="card study-table" aria-label="طاولة الدراسة">
      <div className="table-circle">
        <svg className={`table-ring${p.phase === 'break' ? ' break' : ''}${room.timer.running ? ' running' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="track" />
          <circle cx="50" cy="50" r={R} className="progress" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        <div className="table-center">
          <span className="num table-time" role="timer">
            {fmt(p.remaining)}
          </span>
          <span className="table-phase">
            {p.phase === 'focus' ? 'تركيز' : 'استراحة'} · الجولة {p.round}
            {!room.timer.running && ' · متوقف'}
          </span>
        </div>
        {seats.map((m, i) => {
          const ang = -Math.PI / 2 + (i / seats.length) * Math.PI * 2;
          const burst = bursts.filter((b) => b.userId === m.userId).slice(-1)[0];
          return (
            <span
              key={m.userId}
              className={`seat st-${m.status}${m.userId === meId ? ' me' : ''}`}
              style={{ left: `${50 + Math.cos(ang) * 42}%`, top: `${50 + Math.sin(ang) * 42}%` }}
              title={`${m.name} · ${STATUS_LABEL[m.status]}`}
            >
              <Avatar name={m.name} src={m.avatarUrl} id={m.userId} size={40} />
              <span className="sr-only">
                {m.name}: {STATUS_LABEL[m.status]}
              </span>
              {burst && (
                <span key={burst.id} className="cheer-burst" aria-hidden="true">
                  <Icon name={burst.kind} size={18} />
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div className="table-foot">
        <button type="button" className="toggle" aria-pressed={follow} onClick={() => setFollow(!follow)}>
          <span className="knob" />
          المتابعة مع الغرفة
        </button>
        {owner && (
          <span className="table-controls">
            {room.timer.running ? (
              <button type="button" className="icon-btn" aria-label="إيقاف تايمر الغرفة" onClick={act('pause')}>
                <Icon name="pause" size={18} />
              </button>
            ) : (
              <button type="button" className="icon-btn" aria-label="تشغيل تايمر الغرفة" onClick={act('start')}>
                <Icon name="play" size={18} style={{ transform: 'scaleX(-1)' }} />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="المرحلة التالية" onClick={act('skip')}>
              <Icon name="skip" size={18} style={{ transform: 'scaleX(-1)' }} />
            </button>
            <button type="button" className="icon-btn" aria-label="تصفير تايمر الغرفة" onClick={act('reset')}>
              <Icon name="reset" size={18} />
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

const CHEERS: { kind: CheerKind; icon: IconName; label: string }[] = [
  { kind: 'flame', icon: 'flame', label: 'شعلة' },
  { kind: 'heart', icon: 'heart', label: 'قلب' },
  { kind: 'star', icon: 'star', label: 'نجمة' }
];

/** Quick reactions sent to everyone in the room. */
export function CheerButtons() {
  const [cooldown, setCooldown] = useState(false);
  return (
    <div className="cheers" role="group" aria-label="شجّع الغرفة">
      <span className="muted">شجّع</span>
      {CHEERS.map((c) => (
        <button
          key={c.kind}
          type="button"
          className="cheer-btn"
          aria-label={`تشجيع: ${c.label}`}
          disabled={cooldown}
          onClick={() => {
            getSocket().emit('room:cheer', { kind: c.kind });
            setCooldown(true);
            setTimeout(() => setCooldown(false), 1200);
          }}
        >
          <Icon name={c.icon} size={20} />
        </button>
      ))}
    </div>
  );
}
