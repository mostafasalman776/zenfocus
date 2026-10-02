import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { loadInvite, loadPref, savePref } from '../lib/guest';
import { useMe, useTimerEngine } from '../lib/hooks';
import { usePendingRoomRedirect } from '../pages/RoomsPage';
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
        الدخول بجوجل
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
          const name = window.prompt('اسم للتجربة (تطوير محلي بس)');
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
    <div className="app">
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
              {item.locked && <Icon name="lock" size={14} label="محتاج تسجيل" style={{ marginInlineStart: 'auto', color: 'var(--warm)' }} />}
            </NavLink>
          ))}
          {me?.isAdmin && (
            <NavLink to="/admin">
              <Icon name="flag" />
              البلاغات
            </NavLink>
          )}
        </nav>
        <div className="side-spacer" />
        <div className="legal-links">
          <NavLink to="/privacy">الخصوصية</NavLink>
          <NavLink to="/terms">الشروط</NavLink>
        </div>
        {me ? (
          <div className="me-row">
            <Avatar name={me.name} src={me.avatarUrl} id={me.id} />
            <div className="who">
              <b>{me.name}</b>
              {me.username && <span dir="ltr">@{me.username}</span>}
            </div>
            <button type="button" className="icon-btn" aria-label="تسجيل الخروج" onClick={logout}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13 }} className="muted">
              سجّل عشان تحفظ ساعاتك وتنافس صحابك
            </span>
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
            <ThemeToggle />
            {me ? (
              <button type="button" className="icon-btn" aria-label="تسجيل الخروج" onClick={logout}>
                <Icon name="logout" size={18} />
              </button>
            ) : (
              <LoginButton className="btn sm" />
            )}
          </div>
        </div>
        <Outlet context={{ themeToggle: <ThemeToggle /> }} />
      </main>

      <nav className="mobile-nav" aria-label="القائمة">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <Icon name={item.icon} size={22} />
            {item.label}
            {item.locked && (
              <span className="lock">
                <Icon name="lock" size={12} label="محتاج تسجيل" />
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
