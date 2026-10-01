import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { LoginButton } from '../components/Layout';
import { useMe } from '../lib/hooks';

export function RequireAccount({ what, children }: { what: string; children: ReactNode }) {
  const { me, loading } = useMe();
  if (loading) return null;
  if (me) return <>{children}</>;
  return (
    <section className="card" style={{ maxWidth: 520, margin: '10vh auto 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 32 }}>
      <Icon name="lock" size={32} style={{ color: 'var(--warm)' }} />
      <h1 style={{ fontSize: 22 }}>{what} محتاجة حساب</h1>
      <p className="muted">
        سجّل بحساب جوجل في ثانية. المهام والجلسات اللي عملتها كزائر هتتنقل معاك.
      </p>
      <LoginButton />
    </section>
  );
}
