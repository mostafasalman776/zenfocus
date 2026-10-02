import { ROOM_RULES } from '@zenfocus/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { RequireAccount } from './RequireAccount';

function RoomList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: api.rooms });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: api.createRoom,
    onSuccess: ({ room }) => {
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/rooms/${room.id}`);
    },
    onError: (e) =>
      setError(e instanceof ApiError && e.code === 'too_many_rooms' ? `الحد الأقصى ${ROOM_RULES.maxOwnedRooms} غرف` : 'حدث خطأ')
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>الغرف</h1>
        </div>
      </header>
      <div className="cols rooms-cols">
        <section className="card" aria-label="غرفي">
          <div className="card-head">
            <h2>غرفي</h2>
          </div>
          {rooms.data?.rooms.length ? (
            <div className="room-grid">
              {rooms.data.rooms.map((r) => (
                <Link key={r.id} to={`/rooms/${r.id}`} className="room-card">
                  <span className="room-badge" aria-hidden="true">
                    {r.name.trim().charAt(0)}
                  </span>
                  <span className="room-name">{r.name}</span>
                  <span className="room-meta">
                    <Icon name="users" size={15} />
                    <span className="num">
                      {r.memberCount} / {ROOM_RULES.maxMembers}
                    </span>
                    {r.role === 'owner' && <span className="room-role">المالك</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">لا توجد غرف بعد.</p>
          )}
        </section>
        <div className="stack" style={{ gap: 16 }}>
        <JoinByLink />
        <section className="card" aria-label="غرفة جديدة">
          <div className="card-head">
            <h2>غرفة جديدة</h2>
          </div>
          <form
            className="task-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <label htmlFor="room-name" className="sr-only">
              اسم الغرفة
            </label>
            <input
              id="room-name"
              className="input"
              placeholder="اسم الغرفة"
              maxLength={ROOM_RULES.nameMax}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn" disabled={create.isPending}>
              إنشاء
            </button>
          </form>
          {error && (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 14 }}>
              {error}
            </p>
          )}
        </section>
        </div>
      </div>
    </>
  );
}

/** Paste an invite link (or code) to open its join page. */
function JoinByLink() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  return (
    <section className="card join-link" aria-label="الانضمام برابط دعوة">
      <div className="card-head">
        <h2>
          <Icon name="link" size={18} /> الانضمام برابط دعوة
        </h2>
      </div>
      <form
        className="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          const code = value.trim().split('/').filter(Boolean).pop();
          if (code) navigate(`/r/${encodeURIComponent(code)}`);
        }}
      >
        <label htmlFor="invite-link" className="sr-only">
          رابط الدعوة
        </label>
        <input id="invite-link" className="input" dir="ltr" placeholder="https://…/r/ROOM-XXXX" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn" disabled={!value.trim()}>
          انضمام
        </button>
      </form>
    </section>
  );
}

export function RoomsPage() {
  return (
    <RequireAccount what="الغرف">
      <RoomList />
    </RequireAccount>
  );
}

const PENDING_ROOM = 'zf.pendingRoom';

/** /r/:code — preview the invite, then join. */
export function JoinRoomPage() {
  const { code = '' } = useParams();
  const { me, loading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invite = useQuery({ queryKey: ['roomInvite', code], queryFn: () => api.roomInvite(code), enabled: Boolean(me), retry: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!me) sessionStorage.setItem(PENDING_ROOM, code);
      else sessionStorage.removeItem(PENDING_ROOM);
    } catch {
      /* ignore */
    }
  }, [me, code]);

  useEffect(() => {
    if (invite.data?.isMember) navigate(`/rooms/${invite.data.roomId}`, { replace: true });
  }, [invite.data, navigate]);

  if (loading) return null;
  if (!me) return <RequireAccount what="دخول الغرفة">{null}</RequireAccount>;
  if (invite.isError) {
    return (
      <section className="card" style={{ maxWidth: 480, margin: '10vh auto 0', textAlign: 'center', padding: 32 }}>
        <h1 style={{ fontSize: 22 }}>رابط الدعوة غير صالح</h1>
        <p className="muted">اطلب رابطًا جديدًا من صاحب الغرفة.</p>
      </section>
    );
  }
  if (!invite.data) return null;
  const d = invite.data;
  return (
    <section className="card" style={{ maxWidth: 480, margin: '10vh auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 32 }}>
      <Icon name="users" size={32} style={{ color: 'var(--accent)' }} />
      <h1 style={{ fontSize: 22 }}>{d.name}</h1>
      <p className="muted">
        {d.memberCount} {d.memberCount === 1 ? 'عضو' : 'أعضاء'}
      </p>
      {d.full ? (
        <p style={{ color: 'var(--danger)' }}>الغرفة ممتلئة ({ROOM_RULES.maxMembers} عضو)</p>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              const r = await api.joinRoom(code);
              await qc.invalidateQueries({ queryKey: ['rooms'] });
              navigate(`/rooms/${r.roomId}`, { replace: true });
            } catch {
              setError('تعذّر الانضمام، حاول مرة أخرى');
            }
          }}
        >
          انضمام
        </button>
      )}
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </section>
  );
}

/** After login, send the user back to the room invite they opened. */
export function usePendingRoomRedirect() {
  const { me } = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (!me?.username) return;
    try {
      const code = sessionStorage.getItem(PENDING_ROOM);
      if (code) {
        sessionStorage.removeItem(PENDING_ROOM);
        navigate(`/r/${code}`);
      }
    } catch {
      /* ignore */
    }
  }, [me, navigate]);
}
