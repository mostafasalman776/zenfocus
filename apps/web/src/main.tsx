import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { loadPref, saveInvite } from './lib/guest';
import { FocusPage } from './pages/FocusPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { AdminPage } from './pages/AdminPage';
import { RoomPage } from './pages/RoomPage';
import { JoinRoomPage, RoomsPage } from './pages/RoomsPage';
import { StatsPage } from './pages/StatsPage';
import { WelcomePage } from './pages/WelcomePage';
import './styles/app.css';
import './styles/rooms.css';

document.documentElement.dataset.theme = loadPref('theme', 'dark');

function InviteRoute() {
  const { code } = useParams();
  useEffect(() => {
    if (code) saveInvite(code);
  }, [code]);
  return <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/welcome', element: <WelcomePage /> },
  { path: '/invite/:code', element: <InviteRoute /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <FocusPage /> },
      { path: '/rooms', element: <RoomsPage /> },
      { path: '/rooms/:id', element: <RoomPage /> },
      { path: '/r/:code', element: <JoinRoomPage /> },
      { path: '/admin', element: <AdminPage /> },
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
