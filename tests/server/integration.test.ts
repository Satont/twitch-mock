import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type Options } from '../../src/server';

let app: ReturnType<typeof start> | undefined;
let dir: string | undefined;

function launch(options: Options = {}) {
  app = start({
    httpAddr: '127.0.0.1:0',
    wsAddr: '127.0.0.1:0',
    adminAddr: '127.0.0.1:0',
    ...options,
  });

  return app;
}

function post(base: URL, path: string, body: unknown) {
  return fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  app?.stop();
  app = undefined;

  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('TwitchMock integration', () => {
  test('stream and auth configuration affect Helix and OAuth', async () => {
    const a = launch();
    await post(a.admin.url, '/admin/state/stream', {
      online: true,
      title: 'Integration',
      game_id: '509658',
      game_name: 'Just Chatting',
      viewer_count: 12,
    });
    const stream = await (await fetch(new URL('/helix/streams', a.http.url))).json();
    expect(stream.data[0]).toMatchObject({
      title: 'Integration',
      game_id: '509658',
      viewer_count: 12,
    });
    await post(a.admin.url, '/admin/state/auth', {
      rejectRefresh: true,
      invalidAccessToken: true,
      missingScopes: [],
    });

    const response = await fetch(new URL('/helix/users', a.http.url), {
      headers: { authorization: 'Bearer mock-user-token' },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('Ratelimit-Limit')).toBe('800');
    expect((await post(a.http.url, '/oauth2/token?grant_type=refresh_token', {})).status).toBe(400);
  });

  test('EventSub sessions receive admin events and subscription duplicates conflict', async () => {
    const a = launch();
    const socket = new WebSocket(`ws://127.0.0.1:${a.ws.port}/ws`);
    const messages: any[] = [];

    const next = () =>
      new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('websocket timed out')), 3000);
        socket.addEventListener(
          'message',
          (event) => {
            clearTimeout(timeout);
            const value = JSON.parse(String(event.data));
            messages.push(value);
            resolve(value);
          },
          { once: true },
        );
      });

    const welcome = await next();
    expect(welcome.metadata.message_type).toBe('session_welcome');

    const sub = {
      type: 'channel.follow',
      version: '2',
      condition: { broadcaster_user_id: '12345' },
      transport: { method: 'websocket', session_id: welcome.payload.session.id },
    };

    expect((await post(a.http.url, '/helix/eventsub/subscriptions', sub)).status).toBe(202);
    expect((await post(a.http.url, '/helix/eventsub/subscriptions', sub)).status).toBe(409);
    const incoming = next();
    await post(a.admin.url, '/admin/trigger/channel.follow', { user_id: '555' });
    const event = await incoming;
    expect(event.payload.event.user_id).toBe('555');
    expect(event.metadata.subscription_type).toBe('channel.follow');

    const follows = await (
      await fetch(new URL('/helix/channels/followers?user_id=555', a.http.url))
    ).json();

    expect(follows.data[0].user_id).toBe('555');
    socket.close();
  });

  test('rewards share state across admin, Helix and event feed', async () => {
    const a = launch();

    const created = await (
      await post(a.admin.url, '/admin/rewards', {
        title: 'Hydrate',
        cost: 100,
        is_max_per_stream_enabled: true,
        max_per_stream: 4,
      })
    ).json();

    const reward = created.data;
    expect(reward.max_per_stream_setting).toEqual({ is_enabled: true, max_per_stream: 4 });

    const rewards = await (
      await fetch(new URL(`/helix/channel_points/custom_rewards?id=${reward.id}`, a.http.url))
    ).json();

    expect(rewards.data[0].title).toBe('Hydrate');

    const redeemed = await (
      await post(a.admin.url, '/admin/rewards/redeem', { reward_id: reward.id, user_id: '99999' })
    ).json();

    await post(a.admin.url, '/admin/rewards/redemption-status', {
      reward_id: reward.id,
      redemption_id: redeemed.data.id,
      status: 'FULFILLED',
    });
    const feed = await (await fetch(new URL('/admin/chat/history', a.admin.url))).json();
    const event = feed.items.findLast((item: any) => item.event_type.endsWith('redemption.update'));
    expect(event.data.status).toBe('fulfilled');
    const add = feed.items.find((item: any) => item.event_type.endsWith('reward.add'));
    expect(add.data.max_per_stream).toEqual({ is_enabled: true, value: 4 });
  });

  test('SQLite survives restart and memory starts clean', async () => {
    dir = mkdtempSync(join(tmpdir(), 'twitchmock-'));
    const path = join(dir, 'db.sqlite');
    let a = launch({ storage: 'sqlite', sqlitePath: path });
    await post(a.admin.url, '/admin/state/stream', {
      online: true,
      title: 'Persisted',
      game_id: '',
      game_name: '',
      viewer_count: 3,
    });
    await post(a.admin.url, '/admin/chat/messages', { user_id: '99999', message: 'hello' });
    a.stop();
    app = undefined;
    a = launch({ storage: 'sqlite', sqlitePath: path });
    expect((await (await fetch(new URL('/admin/state/stream', a.admin.url))).json()).title).toBe(
      'Persisted',
    );
    expect(
      (await (await fetch(new URL('/admin/chat/history', a.admin.url))).json()).items,
    ).toHaveLength(1);
    a.stop();
    app = undefined;
    a = launch({ storage: 'memory' });
    expect((await (await fetch(new URL('/admin/state/stream', a.admin.url))).json()).title).toBe(
      'Mock Stream',
    );
  });

  test('SSE resumes after an event and an explicit EventSub version reaches the socket', async () => {
    const a = launch();

    const first = await (
      await post(a.admin.url, '/admin/chat/messages', { user_id: '99999', message: 'first' })
    ).json();

    const second = await (
      await post(a.admin.url, '/admin/chat/messages', { user_id: '99999', message: 'second' })
    ).json();

    const abort = new AbortController();

    const response = await fetch(new URL('/admin/chat/stream', a.admin.url), {
      headers: { 'last-event-id': first.item.id },
      signal: abort.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';

    while (!text.includes(second.item.id)) {
      const chunk = await reader.read();
      text += decoder.decode(chunk.value);
    }

    expect(text).toContain(second.item.id);
    expect(text).not.toContain(first.item.id);
    abort.abort();
    const socket = new WebSocket(`ws://127.0.0.1:${a.ws.port}/ws`);

    const next = () =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('websocket timed out')), 3000);
        socket.addEventListener(
          'message',
          (event) => {
            clearTimeout(timer);
            resolve(JSON.parse(String(event.data)));
          },
          { once: true },
        );
      });

    await next();
    const incoming = next();
    await post(a.admin.url, '/admin/trigger/automod.message.hold?version=1', {});
    const event = await incoming;
    expect(event.metadata.subscription_version).toBe('1');
    expect(typeof event.payload.event.message).toBe('string');
    socket.close();
  });

  test('malformed EventSub input is rejected without changing state', async () => {
    const a = launch();

    for (const body of ['[1,2]', '{"type":']) {
      const response = await fetch(new URL('/helix/eventsub/subscriptions', a.http.url), {
        method: 'POST',
        body,
      });

      expect(response.status).toBe(400);
    }

    expect(
      (await (await fetch(new URL('/helix/eventsub/subscriptions', a.http.url))).json()).data,
    ).toEqual([]);
  });
});
