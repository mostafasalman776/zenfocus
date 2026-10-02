import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { loadInvite, loadPref, savePref } from '../lib/guest';
import { useMe, useTimerEngine } from '../lib/hooks';
import { usePendingRoomRedirect } from '../pages/RoomsPage';
import { FriendsPresence } from './Presence';
import { Sheet } from './Sheet';
import { useTimer } from '../stores/timer';
import { Avatar, Icon, type IconName } from './Icon';

const NAV: { to: string; label: string; icon: IconName; needsAccount: boolean }[] = [
  { to: '/', label: 'التركيز', icon: 'timer', needsAccount: false },
  { to: '/rooms', label: 'الغرف', icon: 'users', needsAccount: true },
  { to: '/leaderboard', label: 'المنافسة', icon: 'trophy', needsAccount: true },
  { to: '/stats', label: 'إحصائياتي', icon: 'chart', needsAccount: true }
];

export function LoginButton({ className = 'btn' }: { className?: string }) {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers, staleTime: Infinity });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invite = loadInvite();

  if (providers.data?.google) {
    const href = `/api/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;
    return (
      <a className={className} href={href}>
        تسجيل الدخول باستخدام Google
      </a>
    );
  }
  if (providers.data?.devLogin) {
    // Local development without Google credentials.
    return (
      <button
        type="button"
        className={className}
        onClick={async () => {
          const name = window.prompt('اسم تجريبي (للتطوير المحلي فقط)');
          if (!name) return;
          const r = await api.devLogin(name, invite ?? undefined);
          await qc.invalidateQueries();
          navigate(r.needsUsername ? '/welcome' : '/');
        }}
      >
        دخول تجريبي
      </button>
    );
  }
  return null;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadPref('theme', 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePref('theme', theme);
  }, [theme]);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={theme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function Toast() {
  const notice = useTimer((s) => s.notice);
  const clear = useTimer((s) => s.clearNotice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(clear, 6000);
    return () => clearTimeout(id);
  }, [notice, clear]);
  if (!notice) return null;
  return (
    <div className="toast" role="status" onClick={clear}>
      {notice}
    </div>
  );
}

export function Layout() {
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  useTimerEngine(me);
  const [accountOpen, setAccountOpen] = useState(false);
  // Inside a room the phone shows the room's own header and composer instead.
  const inRoom = /^\/rooms\/[^/]+/.test(location.pathname);
  usePendingRoomRedirect();

  // New accounts pick a username before anything else.
  useEffect(() => {
    if (me && !me.username && location.pathname !== '/welcome') navigate('/welcome');
  }, [me, location.pathname, navigate]);

  const logout = async () => {
    await api.logout();
    useTimer.setState({ tracked: false });
    await qc.invalidateQueries();
    navigate('/');
  };

  const navItems = NAV.map((item) => ({ ...item, locked: item.needsAccount && !me }));

  return (
    <div className={`app${inRoom ? ' in-room' : ''}`}>
      <aside className="side">
        <NavLink to="/" className="logo" aria-label="ZenFocus">
          <Icon name="feather" size={26} />
          <span>ZenFocus</span>
        </NavLink>
        <nav className="nav" aria-label="القائمة الرئيسية">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <Icon name={item.icon} />
              {item.label}
              {item.locked && <Icon name="lock" size={14} label="يتطلب تسجيل الدخول" style={{ marginInlineStart: 'auto', color: 'var(--warm)' }} />}
            </NavLink>
          ))}
          {me?.isAdmin && (
            <NavLink to="/admin">
              <Icon name="settings" />
              لوحة التحكم
            </NavLink>
          )}
        </nav>
        <div className="side-spacer" />
        <div className="side-foot">
          <div className="legal-links">
            <NavLink to="/privacy">الخصوصية</NavLink>
            <NavLink to="/terms">الشروط</NavLink>
          </div>
          <ThemeToggle />
        </div>
        {me ? (
          <div className="me-row">
            <Avatar name={me.name} src={me.avatarUrl} id={me.id} />
            <div className="who">
              <b>{me.name}</b>
              <NavLink to="/welcome" className="who-username" title="تغيير اسم المستخدم" dir="ltr">
                {me.username ? `@${me.username}` : 'اختر اسم مستخدم'}
              </NavLink>
            </div>
            <button type="button" className="icon-btn" aria-label="تسجيل الخروج" onClick={logout}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LoginButton />
          </div>
        )}
      </aside>

      <main className="main">
        <div className="mobile-top">
          <NavLink to="/" className="logo" aria-label="ZenFocus" style={{ padding: 0 }}>
            <Icon name="feather" size={22} />
            <span style={{ fontSize: 20 }}>ZenFocus</span>
          </NavLink>
          <div className="head-actions">
            {me ? (
              <>
                <FriendsPresence />
                {me.isAdmin && (
                  <NavLink to="/admin" className="icon-btn admin-btn" aria-label="لوحة التحكم">
                    <Icon name="settings" size={20} />
                  </NavLink>
                )}
                <button type="button" className="account-btn" aria-label="الحساب" onClick={() => setAccountOpen(true)}>
                  <Avatar name={me.name} src={me.avatarUrl} id={me.id} size={36} />
                </button>
              </>
            ) : (
              <LoginButton className="btn sm" />
            )}
          </div>
        </div>
        {accountOpen && me && (
          <Sheet title="الحساب" onClose={() => setAccountOpen(false)}>
            <div className="account-head">
              <Avatar name={me.name} src={me.avatarUrl} id={me.id} size={48} />
              <div>
                <b>{me.name}</b>
                {me.username && <span className="muted" dir="ltr">@{me.username}</span>}
              </div>
            </div>
            <div className="account-row">
              <span>المظهر</span>
              <ThemeToggle />
            </div>
            <div className="account-links">
              <NavLink to="/privacy" onClick={() => setAccountOpen(false)}>سياسة الخصوصية</NavLink>
              <NavLink to="/terms" onClick={() => setAccountOpen(false)}>شروط الاستخدام</NavLink>
              <NavLink to="/welcome" onClick={() => setAccountOpen(false)}>تغيير اسم المستخدم</NavLink>
              {me.isAdmin && <NavLink to="/admin" onClick={() => setAccountOpen(false)}>لوحة التحكم</NavLink>}
            </div>
            <button type="button" className="btn danger" onClick={() => { setAccountOpen(false); void logout(); }}>
              <Icon name="logout" size={18} />
              تسجيل الخروج
            </button>
          </Sheet>
        )}
        <Outlet context={{ themeToggle: <ThemeToggle /> }} />
      </main>

      <nav className="mobile-nav" aria-label="القائمة">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <Icon name={item.icon} size={22} />
            {item.label}
            {item.locked && (
              <span className="lock">
                <Icon name="lock" size={12} label="يتطلب تسجيل الدخول" />
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <Toast />
    </div>
  );
}

export { ThemeToggle };
