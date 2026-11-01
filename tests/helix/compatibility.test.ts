import { afterEach, describe, expect, test } from 'bun:test';
import { Core } from '../../src/server/core';
import { api } from '../../src/server/helix';
import { Storage } from '../../src/server/storage';

const stores: Storage[] = [];

function setup() {
  const storage = new Storage('memory');
  stores.push(storage);
  const core = new Core(storage);

  async function request(method: string, path: string, body?: unknown) {
    const response = await api(
      core,
      new Request(`http://localhost${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      }),
      'http://localhost:3005',
    );

    return {
      status: response.status,
      data: response.status === 204 ? null : ((await response.json()) as any),
    };
  }

  return { core, request };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('Helix behavior shared with TwitchMock', () => {
  test('followed channels reflect the configured follower IDs', async () => {
    const { core, request } = setup();
    core.data.follows.followed_user_ids = ['67890', '888'];
    const result = await request('GET', '/helix/channels/followed?user_id=12345');
    expect(result.data.total).toBe(2);
    expect(result.data.data.map((entry: any) => entry.broadcaster_id)).toEqual(['67890', '888']);
  });

  test('poll creation and ending emit corresponding EventSub payloads', async () => {
    const { core, request } = setup();

    const created = await request('POST', '/helix/polls', {
      title: 'Which one?',
      choices: [{ title: 'A' }, { title: 'B' }],
      duration: 60,
    });

    expect(created.status).toBe(200);
    const poll = created.data.data[0];
    expect(core.data.feed.at(-1)?.event_type).toBe('channel.poll.begin');
    expect(core.data.feed.at(-1)?.data.id).toBe(poll.id);
    expect(core.data.feed.at(-1)?.data.title).toBe('Which one?');

    const ended = await request('PATCH', `/helix/polls?broadcaster_id=12345&id=${poll.id}`, {
      status: 'TERMINATED',
    });

    expect(ended.data.data[0].status).toBe('TERMINATED');
    expect(core.data.feed.at(-1)?.event_type).toBe('channel.poll.end');
    expect(core.data.feed.at(-1)?.data.status).toBe('TERMINATED');
  });

  test('suspicious user updates include add and remove side effects', async () => {
    const { core, request } = setup();
    await request('POST', '/helix/moderation/suspicious_users?user_id=555', {});
    expect(core.data.feed.at(-1)?.data).toMatchObject({
      user_id: '555',
      low_trust_status: 'active_monitoring',
    });
    await request('DELETE', '/helix/moderation/suspicious_users?user_id=555');
    expect(core.data.feed.at(-1)?.data).toMatchObject({ user_id: '555', low_trust_status: 'none' });
  });

  test('shield mode mutation is observable through subsequent reads', async () => {
    const { request } = setup();
    expect(
      (await request('PUT', '/helix/moderation/shield_mode', { is_active: false })).status,
    ).toBe(204);
    const read = await request('GET', '/helix/moderation/shield_mode');
    expect(read.data.data[0].is_active).toBe(false);
  });

  test('updates and filtered reads share generic documents', async () => {
    const { request } = setup();

    const updated = await request('PATCH', '/helix/chat/settings?broadcaster_id=12345', {
      slow_mode: true,
      slow_mode_wait_time: 15,
    });

    expect(updated.data.data[0]).toMatchObject({ slow_mode: true, slow_mode_wait_time: 15 });
    const read = await request('GET', '/helix/chat/settings?broadcaster_id=12345');
    expect(read.data.data[0]).toMatchObject({ slow_mode: true, slow_mode_wait_time: 15 });
  });
  test('subscription defaults and duplicates match the original regardless of key order', async () => {
    const { request } = setup();

    const initial = await request('POST', '/helix/eventsub/subscriptions', {
      type: 'channel.follow',
    });

    expect(initial.status).toBe(202);
    expect(initial.data.data[0]).toMatchObject({
      version: '2',
      cost: 0,
      condition: { broadcaster_user_id: '12345', moderator_user_id: '67890' },
      transport: { method: 'websocket' },
    });

    const first = await request('POST', '/helix/eventsub/subscriptions', {
      type: 'custom',
      condition: { one: '1', two: '2' },
      transport: { method: 'websocket', session_id: 'abc' },
    });

    expect(first.status).toBe(202);

    const duplicate = await request('POST', '/helix/eventsub/subscriptions', {
      type: 'custom',
      condition: { two: '2', one: '1' },
      transport: { session_id: 'abc', method: 'websocket' },
    });

    expect(duplicate.status).toBe(409);
    const list = await request('GET', '/helix/eventsub/subscriptions');
    expect(list.data.total_cost).toBe(0);
  });
  test('Helix chat publishes bot events directly, including empty messages', async () => {
    const { core, request } = setup();
    const emitted: any[] = [];
    core.listeners.add((item) => emitted.push(structuredClone(item)));
    const sent = await request('POST', '/helix/chat/messages', {});
    expect(sent.status).toBe(200);
    expect(sent.data.data[0].is_sent).toBe(true);
    expect(emitted.at(-1)).toMatchObject({
      source: 'bot',
      event_type: 'channel.chat.message',
      data: { message: { text: '' }, badges: [{ set_id: 'moderator' }] },
    });
    expect(
      (
        await request('POST', '/helix/chat/announcements', {
          message: 'Announcement',
          color: 'blue',
        })
      ).status,
    ).toBe(204);
    expect(emitted.at(-1)).toMatchObject({
      source: 'bot',
      event_type: 'channel.chat.notification',
      data: { announcement: { color: 'blue' } },
    });
  });
});
