import { useEffect, useState } from 'react';
import { setSound, setVolume, type SoundId } from '../lib/audio';
import { Icon, type IconName } from './Icon';

const SOUNDS: { id: SoundId; label: string; icon: IconName }[] = [
  { id: 'rain', label: 'مطر', icon: 'rain' },
  { id: 'brown', label: 'ضوضاء بنية', icon: 'volume' },
  { id: 'waves', label: 'موج', icon: 'waves' },
  { id: 'white', label: 'ضوضاء ناعمة', icon: 'wind' }
];

export function Sounds() {
  const [on, setOn] = useState<Partial<Record<SoundId, boolean>>>({});
  const [volume, setVol] = useState(0.5);
  const active = SOUNDS.filter((s) => on[s.id]);

  useEffect(() => () => SOUNDS.forEach((s) => setSound(s.id, false, 0)), []);

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
              setOn({ ...on, [s.id]: next });
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
              setVol(v);
              active.forEach((s) => setVolume(s.id, v));
            }}
          />
          <span className="num">{Math.round(volume * 100)}%</span>
        </label>
      )}
    </section>
  );
}
