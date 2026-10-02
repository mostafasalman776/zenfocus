import { ROOM_RULES, type ChatMessage, type Me, type RoomRole } from '@zenfocus/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { compressImage } from '../lib/compress';
import { getSocket } from '../lib/hooks';
import { Avatar, Icon } from './Icon';

const time = (iso: string) => new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

interface Props {
  roomId: string;
  me: Me;
  role: RoomRole;
  messages: ChatMessage[];
  hasMore: boolean;
  onLoadMore: () => void;
  events: { id: number; text: string }[];
  typing: string[];
}

function Bubble({ msg, mine, canDelete, onReply, onEdit }: {
  msg: ChatMessage;
  mine: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
}) {
  const editable = mine && !msg.deleted && msg.kind === 'text' && Date.now() - Date.parse(msg.createdAt) < ROOM_RULES.editWindowSeconds * 1000;
  return (
    <div className={`msg${mine ? ' mine' : ''}`}>
      {!mine && msg.user && <Avatar name={msg.user.name} src={msg.user.avatarUrl} id={msg.user.id} size={34} />}
      <div className="msg-body">
        <span className="msg-meta">
          {!mine && <b>{msg.user?.name ?? 'مستخدم محذوف'}</b>} {time(msg.createdAt)}
          {msg.editedAt && ' · معدّلة'}
        </span>
        {msg.replyTo && (
          <span className="msg-reply">
            <b>{msg.replyTo.userName ?? ''}</b> {msg.replyTo.body}
          </span>
        )}
        {msg.deleted ? (
          <p className="bubble deleted">تم حذف الرسالة</p>
        ) : (
          <>
            {msg.kind === 'image' &&
              (msg.image ? (
                <figure className="msg-image">
                  <a href={msg.image.url} target="_blank" rel="noreferrer">
                    <img
                      src={msg.image.url}
                      alt="صورة في المحادثة"
                      loading="lazy"
                      width={msg.image.width}
                      height={msg.image.height}
                      style={{ aspectRatio: `${msg.image.width} / ${msg.image.height}` }}
                    />
                  </a>
                  <figcaption className="num">
                    {kb(msg.image.bytes)}
                    {msg.image.originalBytes > msg.image.bytes && <s> {kb(msg.image.originalBytes)}</s>}
                  </figcaption>
                </figure>
              ) : (
                <p className="bubble deleted">انتهت صلاحية الصورة</p>
              ))}
            {msg.body && <p className="bubble">{msg.body}</p>}
          </>
        )}
        {!msg.deleted && (
          <span className="msg-actions">
            <button type="button" onClick={onReply}>رد</button>
            {editable && <button type="button" onClick={onEdit}>تعديل</button>}
            {(mine || canDelete) && (
              <button type="button" onClick={() => window.confirm('حذف الرسالة؟') && void api.deleteMessage(msg.id)}>
                حذف
              </button>
            )}
            {!mine && (
              <button
                type="button"
                onClick={() => {
                  const reason = window.prompt('سبب الإبلاغ (اختياري)');
                  if (reason !== null) void api.reportMessage(msg.id, reason).then(() => window.alert('تم إرسال البلاغ'));
                }}
              >
                إبلاغ
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function Chat({ roomId, me, role, messages, hasMore, onLoadMore, events, typing }: Props) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const stickToBottom = useRef(true);

  // Stay pinned to the newest message unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, events, typing]);

  useEffect(() => setError(null), [text]);

  const fail = (e: unknown) =>
    setError(
      e instanceof ApiError && e.status === 429
        ? 'محاولات كثيرة، حاول بعد دقيقة'
        : e instanceof ApiError && e.status === 413
          ? 'الصورة أكبر من 10MB'
          : e instanceof ApiError && e.status === 415
            ? 'الملف ليس صورة'
            : 'تعذّر الإرسال، حاول مرة أخرى'
    );

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    try {
      if (editing) await api.editMessage(editing.id, body);
      else await api.sendMessage(roomId, body, replyTo?.id ?? null);
      setText('');
      setReplyTo(null);
      setEditing(null);
      stickToBottom.current = true;
    } catch (err) {
      fail(err);
    }
  };

  const sendImage = async (file: File) => {
    setUploading(true);
    try {
      const blob = await compressImage(file);
      if (blob.size > ROOM_RULES.imageMaxBytes) throw new ApiError(413, 'too_large');
      await api.sendImage(roomId, blob, text.trim());
      setText('');
      stickToBottom.current = true;
    } catch (err) {
      fail(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="chat" aria-label="المحادثة">
      <div className="chat-head">
        <h2>المحادثة</h2>
      </div>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasMore && (
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={onLoadMore}>
            رسائل أقدم
          </button>
        )}
        {messages.map((msg) =>
          msg.kind === 'system' ? (
            <div key={msg.id} className="sys">
              {msg.body}
            </div>
          ) : (
            <Bubble
              key={msg.id}
              msg={msg}
              mine={msg.user?.id === me.id}
              canDelete={role === 'owner'}
              onReply={() => {
                setEditing(null);
                setReplyTo(msg);
              }}
              onEdit={() => {
                setReplyTo(null);
                setEditing(msg);
                setText(msg.body);
              }}
            />
          )
        )}
        {events.map((ev) => (
          <div key={ev.id} className="sys">
            {ev.text}
          </div>
        ))}
      </div>
      {typing.length > 0 && (
        <div className="typing" aria-live="polite">
          {typing.join('، ')} {typing.length === 1 ? 'يكتب الآن...' : 'يكتبون الآن...'}
        </div>
      )}
      {(replyTo || editing) && (
        <div className="reply-bar">
          <span>
            {editing ? 'تعديل الرسالة' : `ردًا على ${replyTo!.user?.name ?? ''}: ${replyTo!.body.slice(0, 60) || 'صورة'}`}
          </span>
          <button
            type="button"
            aria-label="إلغاء"
            onClick={() => {
              setReplyTo(null);
              if (editing) setText('');
              setEditing(null);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      <form className="composer" onSubmit={send}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendImage(f);
          }}
        />
        <button type="button" className="icon-btn" aria-label="إرسال صورة" disabled={uploading || Boolean(editing)} onClick={() => fileRef.current?.click()}>
          <Icon name="image" />
        </button>
        <label htmlFor="chat-input" className="sr-only">
          رسالة
        </label>
        <input
          id="chat-input"
          className="input"
          placeholder={uploading ? 'جارٍ رفع الصورة...' : 'اكتب رسالة...'}
          value={text}
          maxLength={ROOM_RULES.messageMax}
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              getSocket().emit('chat:typing');
            }
          }}
        />
        <button type="submit" className="icon-btn send" aria-label="إرسال" disabled={!text.trim()}>
          <Icon name="send" style={{ transform: 'scaleX(-1)' }} />
        </button>
      </form>
    </section>
  );
}
