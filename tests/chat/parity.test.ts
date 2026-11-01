import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../../src/server';

let app: ReturnType<typeof start> | undefined;
let directory: string | undefined;

const launch = (storage: 'memory' | 'sqlite' = 'memory', sqlitePath?: string) => {
  app = start({
    httpAddr: '127.0.0.1:0',
    wsAddr: '127.0.0.1:0',
    adminAddr: '127.0.0.1:0',
    storage,
    sqlitePath,
  });

  return app;
};

const post = (base: URL, path: string, body: unknown) =>
  fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(() => {
  app?.stop();
  app = undefined;

  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

test('chat resolves mention identities, preserves thread root and builds announcement payloads', async () => {
  const a = launch();

  const first = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '99999',
      user_login: 'viewer',
      user_name: 'Viewer',
      message: 'hello @mockbot and @MOCKSTREAMER',
      badges: [{ set_id: ' moderator ', id: ' ', info: ' ' }],
    })
  ).json();

  expect(first.item.data.message.fragments).toEqual([
    { type: 'text', text: 'hello ' },
    {
      type: 'mention',
      text: '@mockbot',
      mention: {
        user_id: '67890',
        user_login: 'mockbot',
        user_name: 'MockBot',
      },
    },
    { type: 'text', text: ' and ' },
    {
      type: 'mention',
      text: '@MOCKSTREAMER',
      mention: {
        user_id: '12345',
        user_login: 'mockstreamer',
        user_name: 'MockStreamer',
      },
    },
  ]);
  expect(first.item.data.badges).toEqual([{ set_id: 'moderator', id: '1', info: '' }]);

  const second = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '67890',
      user_login: 'mockbot',
      user_name: 'MockBot',
      message: 'hi',
      reply_to_message_id: first.item.data.message_id,
    })
  ).json();

  expect(second.item.data.message.text).toBe('@viewer hi');
  expect(second.item.data.reply).toMatchObject({
    parent_message_id: first.item.data.message_id,
    thread_message_id: first.item.data.message_id,
    thread_user_id: '99999',
  });

  const third = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '12345',
      message: '@someone reply',
      reply_to_message_id: second.item.data.message_id,
    })
  ).json();

  expect(third.item.data.message.text).toBe('@someone reply');
  expect(third.item.data.reply).toMatchObject({
    parent_message_id: second.item.data.message_id,
    thread_message_id: first.item.data.message_id,
    thread_user_id: '99999',
  });

  const announcement = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '99999',
      message: 'news',
      announce: true,
      announce_color: 'invalid',
    })
  ).json();

  expect(announcement.item.data.announcement.color).toBe('primary');
  expect(announcement.item.data).not.toHaveProperty('message_type');
  expect(announcement.item.data).not.toHaveProperty('cheer');
});

test('SSE replays the complete available history for an unknown event ID', async () => {
  const a = launch();

  const first = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '99999',
      message: 'first',
    })
  ).json();

  const second = await (
    await post(a.admin.url, '/admin/chat/messages', {
      user_id: '99999',
      message: 'second',
    })
  ).json();

  const abort = new AbortController();

  const response = await fetch(new URL('/admin/chat/stream', a.admin.url), {
    headers: { 'last-event-id': 'unknown-or-evicted' },
    signal: abort.signal,
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (!text.includes(second.item.id)) {
    const chunk = await reader.read();
    text += decoder.decode(chunk.value);
  }

  expect(text).toContain(first.item.id);
  expect(text).toContain(second.item.id);
  abort.abort();
});

test('EventSub data is converted into REST records and survives SQLite restart', async () => {
  directory = mkdtempSync(join(tmpdir(), 'twitchmock-chat-'));
  const db = join(directory, 'state.sqlite');
  let a = launch('sqlite', db);
  await post(a.admin.url, '/admin/trigger/channel.channel_points_custom_reward.add', {
    id: 'reward-test',
    title: 'Test reward',
    max_per_stream: { is_enabled: true, value: 5 },
    max_per_user_per_stream: { is_enabled: true, value: 2 },
    global_cooldown: { is_enabled: true, seconds: 30 },
  });
  await post(a.admin.url, '/admin/trigger/channel.channel_points_custom_reward_redemption.add', {
    id: 'redemption-test',
    status: 'unfulfilled',
    reward: { id: 'reward-test', title: 'Test reward', prompt: '', cost: 10 },
  });
  await post(a.admin.url, '/admin/trigger/channel.poll.begin', {
    id: 'poll-test',
    choices: [{ id: 'choice', title: 'Choice', example_user_id: '789' }],
  });
  await post(a.admin.url, '/admin/trigger/channel.subscribe', {
    user_id: '67890',
    tier: '2000',
  });
  await post(a.admin.url, '/admin/trigger/channel.ban', {
    user_id: '67890',
    reason: 'test',
    ends_at: null,
  });
  a.stop();
  app = undefined;
  a = launch('sqlite', db);

  const reward = a.core
    .docs('/helix/channel_points/custom_rewards')
    .find((r) => r.id === 'reward-test');

  expect(reward).toMatchObject({
    max_per_stream_setting: { is_enabled: true, max_per_stream: 5 },
    max_per_user_per_stream_setting: {
      is_enabled: true,
      max_per_user_per_stream: 2,
    },
    global_cooldown_setting: { is_enabled: true, global_cooldown_seconds: 30 },
  });
  expect(reward).not.toHaveProperty('max_per_stream');
  expect(
    a.core
      .docs('/helix/channel_points/custom_rewards/redemptions')
      .find((r) => r.id === 'redemption-test'),
  ).toMatchObject({ reward_id: 'reward-test', status: 'UNFULFILLED' });
  expect(a.core.docs('/helix/polls').find((r) => r.id === 'poll-test')!.choices[0].example_id).toBe(
    '789',
  );
  expect(a.core.docs('/helix/subscriptions').at(-1)).toMatchObject({
    user_id: '67890',
    user_login: 'mockbot',
    tier: '2000',
  });
  expect(a.core.docs('/helix/moderation/banned').at(-1)).toMatchObject({
    user_id: '67890',
    reason: 'test',
    ends_at: null,
  });
  await post(a.admin.url, '/admin/trigger/channel.unban', { user_id: '67890' });
  expect(a.core.docs('/helix/moderation/banned')).toHaveLength(0);
});

test('rejects malformed fields instead of mutating state or throwing', async () => {
  const a = launch();

  for (const [path, body] of [
    ['/admin/state/follows', { followed_user_ids: [17] }],
    ['/admin/state/auth', { missingScopes: [17] }],
    ['/admin/chat/messages', { user_id: 17, message: 'hello' }],
    ['/admin/chat/messages', { user_id: '17', message: 'hello', badges: [{ set_id: 17 }] }],
  ] as const)
    expect((await post(a.admin.url, path, body)).status).toBe(400);
  expect(a.core.data.feed).toHaveLength(0);
});

test('EventSub overrides cannot pollute prototypes and still merge nested data', async () => {
  const a = launch();

  const response = await fetch(new URL('/admin/trigger/channel.poll.begin', a.admin.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"nested":{"__proto__":{"polluted":"yes"},"safe":"value"},"title":"safe"}',
  });

  const result = await response.json();
  expect(response.status).toBe(200);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(result.event.title).toBe('safe');
  expect(result.event.nested).toEqual({ safe: 'value' });
  expect(Object.hasOwn(result.event, 'constructor')).toBe(false);
});

test('EventSub uses the subscription version unless the trigger explicitly selects one', async () => {
  const a = launch();
  const socket = new WebSocket(`ws://127.0.0.1:${a.ws.port}/ws`);

  const next = () =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('websocket timed out')), 3000);

      socket.addEventListener(
        'message',
        (message) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(message.data)));
        },
        { once: true },
      );
    });

  try {
    const welcome = await next();

    const conduit = await (
      await post(a.http.url, '/helix/eventsub/conduits', { shard_count: 1 })
    ).json();

    const conduitId = conduit.data[0].id;

    const shards = await fetch(new URL('/helix/eventsub/conduits/shards', a.http.url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conduit_id: conduitId,
        shards: [
          {
            id: '0',
            transport: {
              method: 'websocket',
              session_id: welcome.payload.session.id,
            },
          },
        ],
      }),
    });

    expect(shards.status).toBe(202);

    const subscription = await (
      await post(a.http.url, '/helix/eventsub/subscriptions', {
        type: 'automod.message.hold',
        version: '1',
        condition: { broadcaster_user_id: '12345', moderator_user_id: '67890' },
        transport: { method: 'conduit', conduit_id: conduitId },
      })
    ).json();

    let incoming = next();

    const automatic = await (
      await post(a.admin.url, '/admin/trigger/automod.message.hold', {})
    ).json();

    let notification = await incoming;
    expect(automatic.version).toBe('2');
    expect(notification.metadata.subscription_version).toBe('1');
    expect(notification.payload.subscription.id).toBe(subscription.data[0].id);
    expect(notification.payload.event).toEqual(automatic.event);

    incoming = next();

    const explicit = await (
      await post(a.admin.url, '/admin/trigger/automod.message.hold?version=2', {})
    ).json();

    notification = await incoming;
    expect(explicit.version).toBe('2');
    expect(notification.metadata.subscription_version).toBe('2');
    expect(notification.payload.subscription.version).toBe('2');
    expect(notification.payload.event).toEqual(explicit.event);

    incoming = next();
    await post(a.admin.url, '/admin/trigger/automod.message.hold?version=1', {});
    notification = await incoming;
    expect(notification.metadata.subscription_version).toBe('1');
    expect(notification.payload.subscription.id).toBe(subscription.data[0].id);
  } finally {
    socket.close();
  }
});
