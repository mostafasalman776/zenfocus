import { create } from 'zustand';
import { setSound, setVolume, type SoundId } from '../lib/audio';
import { Icon, type IconName } from './Icon';

export const SOUNDS: { id: SoundId; label: string; icon: IconName }[] = [
  { id: 'rain', label: 'مطر', icon: 'rain' },
  { id: 'brown', label: 'ضوضاء بنية', icon: 'volume' },
  { id: 'waves', label: 'موج', icon: 'waves' },
  { id: 'white', label: 'ضوضاء ناعمة', icon: 'wind' }
];

// Sound state outlives the component, so closing a sheet keeps the sound playing.
export const useSoundStore = create<{ on: Partial<Record<SoundId, boolean>>; volume: number }>(() => ({ on: {}, volume: 0.5 }));

export function activeSoundLabel(on: Partial<Record<SoundId, boolean>>): string | null {
  const active = SOUNDS.filter((s) => on[s.id]);
  if (!active.length) return null;
  return active.length === 1 ? active[0]!.label : `${active.length} أصوات`;
}

export function Sounds() {
  const { on, volume } = useSoundStore();
  const active = SOUNDS.filter((s) => on[s.id]);

  return (
    <section className="card" aria-label="أصوات الخلفية">
      <div className="card-head">
        <h2>أصوات الخلفية</h2>
      </div>
      <div className="sounds">
        {SOUNDS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sound"
            aria-pressed={Boolean(on[s.id])}
            onClick={() => {
              const next = !on[s.id];
              setSound(s.id, next, volume);
              useSoundStore.setState({ on: { ...on, [s.id]: next } });
            }}
          >
            <Icon name={s.icon} size={22} />
            {s.label}
          </button>
        ))}
      </div>
      {active.length > 0 && (
        <label className="volume">
          <span>مستوى الصوت</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              useSoundStore.setState({ volume: v });
              active.forEach((s) => setVolume(s.id, v));
            }}
          />
          <span className="num">{Math.round(volume * 100)}%</span>
        </label>
      )}
    </section>
  );
}
