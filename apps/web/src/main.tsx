import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter, useParams } from 'react-router';
import { Icon } from './components/Icon';
import { Layout } from './components/Layout';
import { loadPref, saveInvite } from './lib/guest';
import { FocusPage } from './pages/FocusPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { RequireAccount } from './pages/RequireAccount';
import { StatsPage } from './pages/StatsPage';
import { WelcomePage } from './pages/WelcomePage';
import './styles/app.css';

document.documentElement.dataset.theme = loadPref('theme', 'dark');

function InviteRoute() {
  const { code } = useParams();
  useEffect(() => {
    if (code) saveInvite(code);
  }, [code]);
  return <Navigate to="/" replace />;
}

function RoomsPage() {
  return (
    <RequireAccount what="الغرف">
      <section className="card" style={{ maxWidth: 560, margin: '10vh auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 32 }}>
        <Icon name="users" size={32} style={{ color: 'var(--accent)' }} />
        <h1 style={{ fontSize: 22 }}>الغرف جاية في المرحلة الجاية</h1>
        <p className="muted">غرف مذاكرة بتايمر مشترك وشات وصور وفويس.</p>
      </section>
    </RequireAccount>
  );
}

const router = createBrowserRouter([
  { path: '/welcome', element: <WelcomePage /> },
  { path: '/invite/:code', element: <InviteRoute /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <FocusPage /> },
      { path: '/rooms', element: <RoomsPage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/stats', element: <StatsPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
