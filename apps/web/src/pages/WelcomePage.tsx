import { ADMIN_USERNAME_RE, USERNAME_RE } from '@zenfocus/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { ApiError, api } from '../lib/api';
import { clearGuestData, clearInvite, hasGuestData, loadGuestSessions, loadGuestTasks } from '../lib/guest';
import { useMe } from '../lib/hooks';

function suggest(name: string) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return ascii.length >= 3 ? ascii.slice(0, 20) : '';
}

export function WelcomePage() {
  const { me, loading } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState(() => (me ? (me.username ?? suggest(me.name)) : ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guestData = hasGuestData();

  // `me` may arrive after the first render; prefill once it does.
  useEffect(() => {
    if (me) setUsername((u) => u || (me.username ?? suggest(me.name)));
  }, [me]);

  if (loading) return null;
  if (!me) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = username.trim().toLowerCase();
    if (!(me.isAdmin ? ADMIN_USERNAME_RE : USERNAME_RE).test(value)) {
      setError('من 3 إلى 20 حرفًا: أحرف إنجليزية صغيرة وأرقام و _ فقط');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({ username: value });
      if (guestData) {
        await api.importGuest({
          tasks: loadGuestTasks().map((t) => ({
            title: t.title,
            done: t.done,
            estPomodoros: t.estPomodoros,
            donePomodoros: t.donePomodoros
          })),
          sessions: loadGuestSessions()
        });
        clearGuestData();
      }
      clearInvite();
      await qc.invalidateQueries();
      navigate('/');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'اسم المستخدم مستخدم بالفعل'
          : err instanceof ApiError && err.code === 'username_short'
            ? 'من 3 إلى 20 حرفًا: أحرف إنجليزية صغيرة وأرقام و _ فقط'
            : 'حدث خطأ، حاول مرة أخرى'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card welcome" onSubmit={submit}>
        <span className="logo" style={{ padding: 0 }}>
          <Icon name="feather" size={26} />
          <span>ZenFocus</span>
        </span>
        <h1 style={{ fontSize: 24 }}>{me.username ? 'اسم المستخدم' : `مرحبًا، ${me.name.split(' ')[0]}`}</h1>
        <p className="muted">{me.username ? 'اختر اسمًا جديدًا.' : 'اختر اسم مستخدم.'}</p>
        <div className="field">
          <label htmlFor="username">اسم المستخدم</label>
          <div className="prefix">
            <span>@</span>
            <input
              id="username"
              className="input"
              value={username}
              autoFocus
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby="username-hint"
            />
          </div>
          <span id="username-hint" className="hint">
            أحرف إنجليزية صغيرة وأرقام و _ (من 3 إلى 20)
          </span>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
        {guestData && (
          <p className="muted" style={{ fontSize: 14 }}>
            سيتم نقل مهامك وجلساتك السابقة إلى حسابك.
          </p>
        )}
        <button type="submit" className="btn" disabled={busy}>
          متابعة
        </button>
      </form>
    </div>
  );
}
