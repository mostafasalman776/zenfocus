import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { ApiError, api } from '../lib/api';
import { Avatar, Icon } from './Icon';

interface Person {
  id: string;
  name: string;
  speaking: boolean;
  muted: boolean;
}

function snapshot(room: Room): Person[] {
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  return all.map((p) => ({
    id: p.identity,
    name: p.name || p.identity,
    speaking: p.isSpeaking,
    muted: !p.isMicrophoneEnabled
  }));
}

/** Audio-only voice call for a study room (LiveKit). */
export function VoiceBar({ roomId }: { roomId: string }) {
  const roomRef = useRef<Room | null>(null);
  const audioBox = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [people, setPeople] = useState<Person[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => {
    void roomRef.current?.disconnect();
    roomRef.current = null;
    if (audioBox.current) audioBox.current.innerHTML = '';
    setPeople([]);
    setState('idle');
  };

  useEffect(() => leave, [roomId]); // hang up when leaving the room page

  useEffect(() => {
    for (const el of audioBox.current?.querySelectorAll('audio') ?? []) el.muted = deafened;
  }, [deafened, people]);

  const join = async () => {
    setError(null);
    setState('connecting');
    try {
      const { url, token } = await api.voiceToken(roomId);
      const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      roomRef.current = room;
      const refresh = () => setPeople(snapshot(room));
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio) return;
          const el = track.attach();
          el.muted = deafened;
          audioBox.current?.appendChild(el);
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          setPeople([]);
          setState('idle');
        });
      await room.connect(url, token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicOn(true);
      refresh();
      setState('connected');
    } catch (err) {
      leave();
      if (err instanceof ApiError && err.code === 'voice_disabled') setError('المحادثة الصوتية غير مفعّلة');
      else if (err instanceof DOMException && err.name === 'NotAllowedError') setError('يجب السماح باستخدام الميكروفون');
      else setError('تعذّر الاتصال، حاول مرة أخرى');
    }
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
    setPeople(snapshot(room));
  };

  return (
    <section className="card voice" aria-label="المحادثة الصوتية">
      <div ref={audioBox} hidden />
      <span className={`voice-dot${state === 'connected' ? ' on' : ''}`} aria-hidden="true" />
      <div className="voice-info">
        <b>{state === 'connected' ? 'متصل بالمحادثة الصوتية' : 'المحادثة الصوتية'}</b>
        <span className="muted">
          {state === 'connected'
            ? `${people.length} مشاركين${people.some((p) => p.speaking) ? ` · يتحدث: ${people.filter((p) => p.speaking).map((p) => p.name).join('، ')}` : ''}`
            : error ?? ''}
        </span>
      </div>
      {state === 'connected' && (
        <div className="voice-people">
          {people.map((p) => (
            <span key={p.id} className={`voice-person${p.speaking ? ' speaking' : ''}`} title={p.name}>
              <Avatar name={p.name} id={p.id} size={30} />
              {p.muted && (
                <span className="voice-muted">
                  <Icon name="micOff" size={10} label="الميكروفون مغلق" />
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {state === 'connected' ? (
        <div className="head-actions">
          <button type="button" className={`round small${micOn ? '' : ' off'}`} aria-pressed={!micOn} aria-label={micOn ? 'كتم الميكروفون' : 'تشغيل الميكروفون'} onClick={() => void toggleMic()}>
            <Icon name={micOn ? 'mic' : 'micOff'} />
          </button>
          <button type="button" className={`round small${deafened ? ' off' : ''}`} aria-pressed={deafened} aria-label={deafened ? 'تشغيل الصوت' : 'كتم الصوت'} onClick={() => setDeafened(!deafened)}>
            <Icon name="headphones" />
          </button>
          <button type="button" className="btn danger" onClick={leave}>
            مغادرة
          </button>
        </div>
      ) : (
        <button type="button" className="btn subtle" disabled={state === 'connecting'} onClick={() => void join()}>
          <Icon name="mic" size={18} />
          {state === 'connecting' ? 'جارٍ الاتصال...' : 'انضمام'}
        </button>
      )}
    </section>
  );
}
