import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Avatar } from './Icon';

/** "N focusing now" badge: friends with a running focus session. */
export function FriendsPresence() {
  const q = useQuery({ queryKey: ['friendsFocusing'], queryFn: api.friendsFocusing, refetchInterval: 60_000 });
  const friends = q.data?.friends ?? [];
  if (!friends.length) return null;
  return (
    <Link to="/rooms" className="presence-pill" aria-label={`${friends.length} من أصدقائك يركّزون الآن`}>
      <span className="live-dot" aria-hidden="true" />
      <span>{friends.length} يركّزون الآن</span>
      <span className="avatar-stack" aria-hidden="true">
        {friends.slice(0, 3).map((f) => (
          <Avatar key={f.userId} name={f.name} src={f.avatarUrl} id={f.userId} size={24} />
        ))}
      </span>
    </Link>
  );
}
