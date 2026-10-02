import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { env } from '../env.js';

// Voice runs on a self-hosted LiveKit SFU. The API only hands out short-lived
// join tokens to room members and removes people who lose access.

const lkRoom = (roomId: string) => `zf-${roomId}`;

function httpUrl() {
  return env.LIVEKIT_URL!.replace(/^ws/, 'http');
}

export async function voiceToken(roomId: string, user: { id: string; name: string }) {
  const at = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
    identity: user.id,
    name: user.name,
    ttl: '2h'
  });
  at.addGrant({
    room: lkRoom(roomId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    // Audio only in v1.
    canPublishSources: [TrackSource.MICROPHONE]
  });
  return { url: env.LIVEKIT_URL!, token: await at.toJwt() };
}

/** Drop a user (or everyone, for a deleted room) from the room's voice call. Best effort. */
export async function removeFromVoice(roomId: string, userId: string | null) {
  if (!env.voiceEnabled) return;
  const svc = new RoomServiceClient(httpUrl(), env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
  try {
    if (userId) await svc.removeParticipant(lkRoom(roomId), userId);
    else await svc.deleteRoom(lkRoom(roomId));
  } catch {
    /* not in the call, or the call does not exist */
  }
}
