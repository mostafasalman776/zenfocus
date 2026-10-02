import {
  formatDuration,
  roomPhase,
  type ChatMessage,
  type PresenceStatus,
  type RoomDetail,
  type RoomTimer
} from '@zenfocus/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Chat } from '../components/Chat';
import { VoiceBar } from '../components/VoiceBar';
import { Avatar, Icon } from '../components/Icon';
import { api } from '../lib/api';
import { loadPref, savePref } from '../lib/guest';
import { getSocket, useMe } from '../lib/hooks';
import { useTimer } from '../stores/timer';
import { RequireAccount } from './RequireAccount';

const STATUS: Record<PresenceStatus, { label: string; cls: string }> = {
  focus: { label: 'بيذاكر', cls: 'st-focus' },
  paused: { label: 'متوقف مؤقتاً', cls: 'st-paused' },
  online: { label: 'متصل', cls: 'st-online' },
  offline: { label: 'مش متصل', cls: 'st-offline' }
};

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Follow the room timer with the personal (tracked) timer when the user opts in. */
function useFollowRoom(timer: RoomTimer, follow: boolean) {
  const now = useNow();
  const phase = roomPhase(timer, now);
  const status = useTimer((s) => s.status);
  const busy = useRef(false);
  useEffect(() => {
    if (!follow || busy.current) return;
    const t = useTimer.getState();
    let action: Promise<void> | null = null;
    if (timer.running && phase.phase === 'focus') {
      if (status === 'idle' && phase.remaining >= 5 * 60) action = t.startFor(phase.remaining, true);
      else if (status === 'paused' && t.mode === 'focus') action = t.resume();
    } else if (!timer.running && status === 'running' && t.mode === 'focus') {
      action = t.pause();
    }
    if (action) {
      busy.current = true;
      action.catch(() => undefined).finally(() => (busy.current = false));
    }
  }, [follow, timer.running, phase.phase, phase.round, status, phase.remaining]);
}

function TimerBar({ room, follow, setFollow }: { room: RoomDetail; follow: boolean; setFollow: (v: boolean) => void }) {
  const now = useNow();
  const p = roomPhase(room.timer, now);
  const owner = room.role === 'owner';
  const pct = 100 - Math.round((p.remaining / p.length) * 100);
  const act = (a: 'start' | 'pause' | 'reset' | 'skip') => () => void api.roomTimer(room.id, a);
  return (
    <section className="card room-timer" aria-label="تايمر الغرفة">
      <div>
        <span className="muted" style={{ fontSize: 13 }}>تايمر الغرفة</span>
        <div className="num room-time">{fmt(p.remaining)}</div>
      </div>
      <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: p.phase === 'focus' ? 'var(--accent-hover)' : 'var(--warm)' }}>
            {p.phase === 'focus' ? 'تركيز' : 'بريك'} · الجولة {p.round}
            {!room.timer.running && ' · واقف'}
          </span>
          <span className="muted">
            {room.timer.focusMinutes}د تركيز / {room.timer.breakMinutes}د بريك
          </span>
        </div>
        <div className="bar" style={{ height: 8 }}>
          <div style={{ width: `${pct}%`, background: p.phase === 'focus' ? 'var(--accent)' : 'var(--warm)' }} />
        </div>
      </div>
      <div className="head-actions">
        {owner && (
          <>
            {room.timer.running ? (
              <button type="button" className="icon-btn" aria-label="إيقاف تايمر الغرفة" onClick={act('pause')}>
                <Icon name="pause" />
              </button>
            ) : (
              <button type="button" className="icon-btn" aria-label="تشغيل تايمر الغرفة" onClick={act('start')}>
                <Icon name="play" style={{ transform: 'scaleX(-1)' }} />
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="المرحلة الجاية" onClick={act('skip')}>
              <Icon name="skip" style={{ transform: 'scaleX(-1)' }} />
            </button>
            <button type="button" className="icon-btn" aria-label="تصفير تايمر الغرفة" onClick={act('reset')}>
              <Icon name="reset" />
            </button>
          </>
        )}
        <button type="button" className="toggle" aria-pressed={follow} onClick={() => setFollow(!follow)}>
          <span className="knob" />
          ذاكر مع الغرفة
        </button>
      </div>
    </section>
  );
}

function Members({ room, meId }: { room: RoomDetail; meId: string }) {
  const sorted = [...room.members].sort(
    (a, b) => ['focus', 'paused', 'online', 'offline'].indexOf(a.status) - ['focus', 'paused', 'online', 'offline'].indexOf(b.status)
  );
  return (
    <section aria-label="الأعضاء" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ fontSize: 17 }}>
        الأعضاء <span className="muted num">{room.memberCount}</span>
      </h2>
      <div className="members">
        {sorted.map((m) => (
          <article key={m.userId} className={`member${m.userId === meId ? ' me' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className={`presence ${STATUS[m.status].cls}`}>
                <Avatar name={m.name} src={m.avatarUrl} id={m.userId} size={44} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flexGrow: 1 }}>
                <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                  {m.userId === meId && ' (أنت)'}
                </b>
                <span className="muted" style={{ fontSize: 12 }}>
                  {m.role === 'owner' ? 'المالك' : m.username ? `@${m.username}` : ''}
                </span>
              </div>
              {room.role === 'owner' && m.userId !== meId && (
                <button
                  type="button"
                  className="del"
                  style={{ opacity: 1 }}
                  aria-label={`طرد ${m.name}`}
                  onClick={() => window.confirm(`تطرد ${m.name} من الغرفة؟`) && void api.kick(room.id, m.userId)}
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={`status-chip ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
              <span className="num muted" style={{ fontSize: 13 }}>
                النهارده {formatDuration(m.todaySeconds)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Room({ id }: { id: string }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const roomQ = useQuery({ queryKey: ['room', id], queryFn: () => api.room(id), retry: false });
  const room = roomQ.data?.room;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [events, setEvents] = useState<{ id: number; text: string }[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [tab, setTab] = useState<'chat' | 'members'>('chat');
  const [follow, setFollowState] = useState(() => loadPref(`follow.${id}`, false));
  const eventId = useRef(0);
  const setFollow = (v: boolean) => {
    setFollowState(v);
    savePref(`follow.${id}`, v);
  };
  useFollowRoom(room?.timer ?? { focusMinutes: 25, breakMinutes: 5, running: false, startedAt: null, elapsedSeconds: 0 }, follow && Boolean(room));

  // Initial messages.
  useEffect(() => {
    let cancelled = false;
    api
      .messages(id)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        setHasMore(r.messages.length >= 50);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live updates.
  useEffect(() => {
    const s = getSocket();
    const join = () => s.emit('room:join', { roomId: id });
    join();
    s.on('connect', join);
    const patchRoom = (fn: (r: RoomDetail) => RoomDetail) =>
      qc.setQueryData<{ room: RoomDetail }>(['room', id], (old) => (old ? { room: fn(old.room) } : old));
    const onMessage = (msg: ChatMessage) => {
      if (msg.roomId !== id) return;
      setMessages((list) => (list.some((x) => x.id === msg.id) ? list : [...list, msg]));
      const authorId = msg.user?.id;
      if (authorId) {
        setTyping((cur) => {
          const next = { ...cur };
          delete next[authorId];
          return next;
        });
      }
    };
    const onUpdate = (msg: ChatMessage) => setMessages((list) => list.map((x) => (x.id === msg.id ? msg : x)));
    const onTyping = (t: { userId: string; name: string }) => setTyping((cur) => ({ ...cur, [t.userId]: { name: t.name, at: Date.now() } }));
    const onStatus = (p: { userId: string; status: PresenceStatus }) =>
      patchRoom((r) => ({ ...r, members: r.members.map((m) => (m.userId === p.userId ? { ...m, status: p.status } : m)) }));
    const onTimer = (timer: RoomTimer) => patchRoom((r) => ({ ...r, timer }));
    const refetch = () => void qc.invalidateQueries({ queryKey: ['room', id] });
    const onEvent = (e: { text: string }) => setEvents((list) => [...list.slice(-4), { id: ++eventId.current, text: e.text }]);
    const onRemoved = (e: { roomId: string }) => {
      if (e.roomId !== id) return;
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      navigate('/rooms');
    };
    s.on('chat:message', onMessage);
    s.on('chat:update', onUpdate);
    s.on('chat:typing', onTyping);
    s.on('room:status', onStatus);
    s.on('room:timer', onTimer);
    s.on('room:members', refetch);
    s.on('room:updated', refetch);
    s.on('room:event', onEvent);
    s.on('room:removed', onRemoved);
    return () => {
      s.emit('room:leave');
      s.off('connect', join);
      s.off('chat:message', onMessage);
      s.off('chat:update', onUpdate);
      s.off('chat:typing', onTyping);
      s.off('room:status', onStatus);
      s.off('room:timer', onTimer);
      s.off('room:members', refetch);
      s.off('room:updated', refetch);
      s.off('room:event', onEvent);
      s.off('room:removed', onRemoved);
    };
  }, [id, qc, navigate]);

  // Typing indicators fade after a few seconds.
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((cur) => {
        const fresh = Object.fromEntries(Object.entries(cur).filter(([, v]) => Date.now() - v.at < 5000));
        return Object.keys(fresh).length === Object.keys(cur).length ? cur : fresh;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (roomQ.isError) {
    return (
      <section className="card" style={{ maxWidth: 480, margin: '10vh auto 0', textAlign: 'center', padding: 32 }}>
        <h1 style={{ fontSize: 22 }}>الغرفة دي مش موجودة أو إنت مش عضو فيها</h1>
      </section>
    );
  }
  if (!room || !me) return null;

  const inviteUrl = `${location.origin}/r/${room.inviteCode}`;
  const focusing = room.members.filter((m) => m.status === 'focus').length;

  return (
    <div className="room">
      <div className="room-main">
        <header className="page-head">
          <div>
            <h1>{room.name}</h1>
            <p>
              {room.memberCount} أعضاء · {focusing} بيذاكروا دلوقتي
            </p>
          </div>
          <div className="head-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => void navigator.clipboard?.writeText(inviteUrl).then(() => window.alert('اتنسخ لينك الدعوة'))}
            >
              <Icon name="userPlus" size={18} />
              لينك الدعوة
            </button>
            {room.role === 'owner' ? (
              <button
                type="button"
                className="icon-btn"
                aria-label="إعدادات الغرفة"
                onClick={async () => {
                  const name = window.prompt('اسم الغرفة', room.name);
                  if (name === null) return;
                  const focus = Number(window.prompt('دقايق التركيز في تايمر الغرفة', String(room.timer.focusMinutes)));
                  const brk = Number(window.prompt('دقايق البريك', String(room.timer.breakMinutes)));
                  await api
                    .updateRoom(room.id, {
                      name: name.trim() || room.name,
                      ...(focus >= 5 && focus <= 180 ? { focusMinutes: focus } : {}),
                      ...(brk >= 1 && brk <= 60 ? { breakMinutes: brk } : {})
                    })
                    .catch(() => window.alert('معرفناش نحفظ'));
                }}
              >
                <Icon name="settings" />
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost"
                onClick={() => window.confirm('تخرج من الغرفة؟') && void api.leaveRoom(room.id).then(() => navigate('/rooms'))}
              >
                خروج
              </button>
            )}
          </div>
        </header>
        <TimerBar room={room} follow={follow} setFollow={setFollow} />
        <VoiceBar roomId={room.id} />
        <div className="segmented room-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            الشات
          </button>
          <button type="button" role="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>
            الأعضاء
          </button>
        </div>
        <div className={tab === 'members' ? '' : 'hide-on-mobile'}>
          <Members room={room} meId={me.id} />
        </div>
      </div>
      <div className={tab === 'chat' ? 'room-chat' : 'room-chat hide-on-mobile'}>
        <Chat
          roomId={room.id}
          me={me}
          role={room.role}
          messages={messages}
          hasMore={hasMore}
          events={events}
          typing={Object.values(typing).map((t) => t.name)}
          onLoadMore={async () => {
            const first = messages[0];
            if (!first) return;
            const r = await api.messages(id, first.createdAt);
            setMessages((list) => [...r.messages, ...list]);
            setHasMore(r.messages.length >= 50);
          }}
        />
      </div>
    </div>
  );
}

export function RoomPage() {
  const { id = '' } = useParams();
  return (
    <RequireAccount what="الغرف">
      <Room key={id} id={id} />
    </RequireAccount>
  );
}
