import { useEffect, useRef, useState } from 'react';
import { Button, Field, Form, Notice, Panel, request, useNotice, type Json } from './shared';

const presets: Record<string, { id: string; login: string; name: string; badges: string[] }> = {
  viewer: { id: '99999', login: 'viewer', name: 'Viewer', badges: [] },
  broadcaster: {
    id: '12345',
    login: 'mockstreamer',
    name: 'MockStreamer',
    badges: ['broadcaster'],
  },
  moderator: {
    id: '11111',
    login: 'moduser',
    name: 'ModUser',
    badges: ['moderator'],
  },
  vip: { id: '22222', login: 'vipuser', name: 'VipUser', badges: ['vip'] },
  subscriber: {
    id: '33333',
    login: 'subuser',
    name: 'SubUser',
    badges: ['subscriber'],
  },
  bot: {
    id: '67890',
    login: 'mockbot',
    name: 'MockBot',
    badges: ['moderator'],
  },
};

const messageEvent = (item: Json) =>
  item.event_type === 'channel.chat.message' ||
  (item.event_type === 'channel.chat.notification' && item.data?.notice_type === 'announcement');

function applyItem(items: Json[], item: Json) {
  if (items.some((old) => old.id === item.id)) return items;
  let next = items;

  if (item.event_type === 'channel.chat.message_delete')
    next = next.filter((old) => old.data?.message_id !== item.data?.message_id);

  if (item.event_type === 'channel.chat.clear') next = next.filter((old) => !messageEvent(old));

  if (item.event_type === 'channel.chat.clear_user_messages')
    next = next.filter(
      (old) => !messageEvent(old) || old.data?.chatter_user_id !== item.data?.target_user_id,
    );

  return [...next, item].slice(-300);
}

export function Chat() {
  const [items, setItems] = useState<Json[]>([]),
    [connection, setConnection] = useState('Connecting'),
    [showEvents, setShowEvents] = useState(true);

  const [identity, setIdentity] = useState(presets.viewer),
    [preset, setPreset] = useState('viewer'),
    [color, setColor] = useState(''),
    [months, setMonths] = useState(13);

  const [message, setMessage] = useState(''),
    [messageType, setMessageType] = useState('text'),
    [bits, setBits] = useState(0),
    [reward, setReward] = useState(''),
    [announce, setAnnounce] = useState(false),
    [announceColor, setAnnounceColor] = useState('primary'),
    [reply, setReply] = useState<Json | null>(null);

  const notice = useNotice(),
    feedEnd = useRef<HTMLDivElement>(null);

  const { setNotice } = notice;

  useEffect(() => {
    let active = true,
      loadingHistory = false,
      generation = 0;

    let pending: Json[] = [];
    const source = new EventSource('/admin/chat/stream');
    source.onopen = () => {
      setConnection('Connected');
      loadingHistory = true;
      pending = [];
      const currentGeneration = ++generation;
      request('/admin/chat/history?limit=300')
        .then((data) => {
          if (!active || currentGeneration !== generation) return;
          loadingHistory = false;
          setItems(pending.reduce(applyItem, data.items ?? []));
          pending = [];
        })
        .catch((error) => {
          if (!active || currentGeneration !== generation) return;
          loadingHistory = false;
          setItems((current) => pending.reduce(applyItem, current));
          pending = [];
          setNotice({
            text: `Could not load chat history: ${error.message}`,
            error: true,
          });
        });
    };

    source.onerror = () => setConnection('Reconnecting');
    source.addEventListener('feed', (event) => {
      try {
        const item = JSON.parse((event as MessageEvent).data);

        if (loadingHistory) pending.push(item);
        else setItems((current) => applyItem(current, item));
      } catch {
        setNotice({
          text: 'Received an invalid feed event',
          error: true,
        });
      }
    });

    return () => {
      active = false;
      source.close();
    };
  }, [setNotice]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [items]);

  function choosePreset(value: string) {
    setPreset(value);

    if (presets[value]) setIdentity({ ...presets[value] });
  }

  function changeIdentity(field: 'id' | 'login' | 'name', value: string) {
    setPreset('custom');
    setIdentity({ ...identity, [field]: value });
  }

  function toggleBadge(badge: string, checked: boolean) {
    setPreset('custom');
    setIdentity({
      ...identity,
      badges: checked ? [...identity.badges, badge] : identity.badges.filter((v) => v !== badge),
    });
  }

  async function send() {
    const ok = await notice.run(async () => {
      await request('/admin/chat/messages', {
        user_id: identity.id,
        user_login: identity.login,
        user_name: identity.name,
        message,
        color,
        badges: identity.badges.map((badge) => ({
          set_id: badge,
          id: badge === 'subscriber' ? String(months) : '1',
          info: badge === 'subscriber' ? String(months) : '',
        })),
        message_type: messageType,
        bits,
        reply_to_message_id: reply?.message_id ?? '',
        channel_points_custom_reward_id: reward,
        announce,
        announce_color: announceColor,
      });
    }, 'Message sent');

    if (ok) {
      setMessage('');
      setReply(null);
    }
  }

  async function action(path: string, body: Json, text: string) {
    await notice.run(async () => {
      await request(path, body);

      if (path.endsWith('/history/clear')) setItems([]);
    }, text);
  }

  const visible = items.filter((item) => showEvents || messageEvent(item));

  return (
    <div className="chat-layout">
      <Panel
        title="Activity feed"
        description="Messages and EventSub events appear here in real time"
        className="chat-panel"
        action={
          <span className={`connection ${connection === 'Connected' ? 'connected' : ''}`}>
            <i />
            {connection}
          </span>
        }
      >
        <div className="feed-toolbar">
          <label>
            <input
              type="checkbox"
              checked={showEvents}
              onChange={(e) => setShowEvents(e.target.checked)}
            />{' '}
            Show events
          </label>
          <span>
            {items.filter(messageEvent).length} messages ·{' '}
            {items.filter((i) => !messageEvent(i)).length} events
          </span>
        </div>
        <div className="feed" aria-live="polite">
          {visible.length === 0 && (
            <div className="empty feed-empty">
              <strong>Nothing here yet</strong>
              <span>Send a message or trigger an event to start the feed</span>
            </div>
          )}
          {visible.map((item) => {
            const data = item.data ?? {},
              isMessage = messageEvent(item);

            return isMessage ? (
              <div className="feed-message" key={item.id}>
                <div className="message-line">
                  <span className="chat-avatar" aria-hidden="true">
                    {String(data.chatter_user_name || data.chatter_user_login || '?')
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div className="message-body">
                    <div className="message-meta">
                      <strong style={data.color ? { color: data.color } : undefined}>
                        {data.chatter_user_name || data.chatter_user_login || 'Unknown'}
                      </strong>
                      {(data.badges ?? []).map((b: Json, index: number) => (
                        <span className="badge" key={`${b.set_id}-${index}`}>
                          {b.set_id}
                          {b.set_id === 'subscriber' && b.id ? ` ${b.id}` : ''}
                        </span>
                      ))}
                      <time>
                        {item.at
                          ? new Date(item.at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </time>
                    </div>
                    {data.reply && (
                      <div className="reply-quote">
                        Replying to {data.reply.parent_user_name || data.reply.parent_user_login}:{' '}
                        {data.reply.parent_message_body}
                      </div>
                    )}
                    <p>{data.message?.text ?? ''}</p>
                    {data.cheer?.bits > 0 && <small>{data.cheer.bits} bits</small>}{' '}
                    {data.message_type && data.message_type !== 'text' && (
                      <small>{data.message_type}</small>
                    )}
                  </div>
                </div>
                <div className="feed-actions">
                  {data.message_id && (
                    <>
                      <button onClick={() => setReply(data)}>Reply</button>
                      <button
                        onClick={() =>
                          void action(
                            '/admin/chat/delete',
                            { message_id: data.message_id },
                            'Message deleted',
                          )
                        }
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {data.chatter_user_id && (
                    <button
                      onClick={() =>
                        void action(
                          '/admin/chat/clear-user',
                          {
                            user_id: data.chatter_user_id,
                            user_login: data.chatter_user_login,
                            user_name: data.chatter_user_name,
                          },
                          'User messages cleared',
                        )
                      }
                    >
                      Clear user
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="feed-event" key={item.id}>
                <span className="event-dot" />
                <div>
                  <strong>{item.event_type}</strong>
                  <details>
                    <summary>View event data</summary>
                    <pre>{JSON.stringify(data, null, 2)}</pre>
                  </details>
                </div>
                <time>
                  {item.at
                    ? new Date(item.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </time>
              </div>
            );
          })}
          <div ref={feedEnd} />
        </div>
        <Form className="composer" onSubmit={send}>
          {reply && (
            <div className="reply-banner">
              Replying to <strong>{reply.chatter_user_name}</strong>: {reply.message?.text}
              <button type="button" onClick={() => setReply(null)}>
                Cancel
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="chat-message">
            Message
          </label>
          <textarea
            id="chat-message"
            rows={2}
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                if (message.trim()) void send();
              }
            }}
            placeholder="Write a message…"
          />
          <div className="composer-bottom">
            <span>Enter to send · Shift + Enter for a new line</span>
            <Button disabled={!message.trim()}>Send message</Button>
          </div>
          <details className="advanced">
            <summary>Advanced message options</summary>
            <div className="two-cols">
              <Field label="Message type">
                <select value={messageType} onChange={(e) => setMessageType(e.target.value)}>
                  {[
                    'text',
                    'user_intro',
                    'channel_points_highlighted',
                    'channel_points_sub_only',
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cheer bits">
                <input
                  type="number"
                  min="0"
                  value={bits}
                  onChange={(e) => setBits(Number(e.target.value))}
                />
              </Field>
              <Field label="Custom reward ID">
                <input value={reward} onChange={(e) => setReward(e.target.value)} />
              </Field>
              <Field label="Announcement color">
                <select value={announceColor} onChange={(e) => setAnnounceColor(e.target.value)}>
                  {['primary', 'blue', 'green', 'orange', 'purple'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={announce}
                onChange={(e) => setAnnounce(e.target.checked)}
              />{' '}
              Send as announcement
            </label>
          </details>
          <Notice value={notice.notice} />
        </Form>
      </Panel>
      <div className="stack">
        <Panel title="Send as" description="Choose an identity for outgoing messages">
          <div className="form-stack">
            <Field label="Preset">
              <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
                {[...Object.keys(presets), 'custom'].map((v) => (
                  <option key={v} value={v}>
                    {v[0].toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="User ID">
              <input value={identity.id} onChange={(e) => changeIdentity('id', e.target.value)} />
            </Field>
            <Field label="Login">
              <input
                value={identity.login}
                onChange={(e) => changeIdentity('login', e.target.value)}
              />
            </Field>
            <Field label="Display name">
              <input
                value={identity.name}
                onChange={(e) => changeIdentity('name', e.target.value)}
              />
            </Field>
            <Field label="Name color">
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#1E90FF"
              />
            </Field>
            <fieldset className="badge-field">
              <legend>Badges</legend>
              <div className="inline-checks">
                {['broadcaster', 'moderator', 'vip', 'subscriber'].map((b) => (
                  <label key={b}>
                    <input
                      type="checkbox"
                      checked={identity.badges.includes(b)}
                      onChange={(e) => toggleBadge(b, e.target.checked)}
                    />
                    {b}
                  </label>
                ))}
              </div>
            </fieldset>
            {identity.badges.includes('subscriber') && (
              <Field label="Subscriber months">
                <input
                  type="number"
                  min="1"
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                />
              </Field>
            )}
          </div>
        </Panel>
        <Panel title="Chat actions" description="Moderate or clear the local feed">
          <div className="action-list">
            <Button secondary onClick={() => void action('/admin/chat/clear', {}, 'Chat cleared')}>
              Clear chat
            </Button>
            <Button
              secondary
              onClick={() =>
                void action(
                  '/admin/chat/clear-user',
                  {
                    user_id: identity.id,
                    user_login: identity.login,
                    user_name: identity.name,
                  },
                  'Sender messages cleared',
                )
              }
            >
              Clear sender messages
            </Button>
            <Button
              secondary
              onClick={() => void action('/admin/chat/history/clear', {}, 'Local history cleared')}
            >
              Clear local history
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
