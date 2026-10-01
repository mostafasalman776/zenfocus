import { LIMITS } from '@zenfocus/shared';
import { useState } from 'react';
import type { TasksApi } from '../lib/hooks';
import { useTimer } from '../stores/timer';
import { Icon } from './Icon';

export function TaskList({ api }: { api: TasksApi }) {
  const [title, setTitle] = useState('');
  const [est, setEst] = useState(1);
  const currentId = useTimer((s) => s.taskId);
  const setTask = useTimer((s) => s.setTask);
  const idle = useTimer((s) => s.status === 'idle');
  const done = api.tasks.filter((t) => t.done).length;

  const sorted = [...api.tasks].sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position);

  return (
    <section className="card" aria-label="المهام">
      <div className="card-head">
        <h2>مهامي</h2>
        <span className="num muted" style={{ fontSize: 13 }}>
          {done} / {api.tasks.length}
        </span>
      </div>
      <form
        className="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = title.trim();
          if (!v) return;
          api.add(v, est);
          setTitle('');
          setEst(1);
        }}
      >
        <label htmlFor="new-task" className="sr-only">
          مهمة جديدة
        </label>
        <input
          id="new-task"
          className="input"
          placeholder="ضيف مهمة جديدة..."
          value={title}
          maxLength={LIMITS.taskTitleMax}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="new-est" className="sr-only">
          عدد الجلسات المتوقعة
        </label>
        <select
          id="new-est"
          className="input num"
          style={{ width: 64, padding: '0 8px' }}
          value={est}
          onChange={(e) => setEst(Number(e.target.value))}
          title="كام جلسة متوقعة"
        >
          {[1, 2, 3, 4, 5, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="submit" className="icon-btn" aria-label="إضافة مهمة" style={{ flexShrink: 0 }}>
          <Icon name="plus" />
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="empty">مفيش مهام لسه. ابدأ بحاجة صغيرة.</p>
      ) : (
        <ul className="tasks">
          {sorted.map((t) => (
            <li key={t.id} className={`task${t.done ? ' done' : ''}${t.id === currentId ? ' current' : ''}`}>
              <button
                type="button"
                className="check"
                aria-pressed={t.done}
                aria-label={t.done ? `رجّع "${t.title}"` : `خلصت "${t.title}"`}
                onClick={() => api.toggle(t)}
              >
                {t.done && <Icon name="check" size={14} />}
              </button>
              <span
                className="title"
                onDoubleClick={() => idle && !t.done && setTask(t.id)}
                title={idle && !t.done ? 'دبل كليك عشان تشتغل عليها' : undefined}
              >
                {t.title}
              </span>
              <span className="pomos" title="جلسات خلصت / متوقعة">
                <Icon name="timer" size={14} />
                {t.donePomodoros}/{t.estPomodoros}
              </span>
              <button type="button" className="del" aria-label={`امسح "${t.title}"`} onClick={() => api.remove(t)}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
