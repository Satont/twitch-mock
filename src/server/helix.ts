import operations from '../data/operations.json';
import { Core, broad, buildEvent, clone, definition, id, match, merge, now, user } from './core';
import { isDeepStrictEqual } from 'node:util';
import { admin, applyReward, redemptionEvent, rewardEvent, validateReward } from './admin';
import type { Document } from './storage';
import { helixHook } from './helix-hooks';
import { chatMessage, replyFor } from './chat';

const json = (value: unknown, status = 200) => Response.json(value, { status });

const fail = (status: number, error: string, message: string) =>
  json({ error, status, message }, status);

const noContent = () => new Response(null, { status: 204 });
const rewardPath = '/helix/channel_points/custom_rewards';
const redemptionPath = `${rewardPath}/redemptions`;

const actions = new Set([
  'start-commercial',
  'snooze-next-ad',
  'check-automod-status',
  'manage-held-automod-messages',
  'warn-chat-user',
  'add-suspicious-status-to-chat-user',
  'remove-suspicious-status-from-chat-user',
  'start-a-raid',
  'send-chat-announcement',
  'send-chat-message',
  'send-a-shoutout',
  'send-extension-chat-message',
  'send-extension-pubsub-message',
  'send-guest-star-invite',
  'send-whisper',
]);

const scopes: Record<string, string> = {
  'GET /helix/moderation/moderators': 'moderation:read',
  'GET /helix/chat/chatters': 'moderator:read:chatters',
  'PATCH /helix/channels': 'channel:manage:broadcast',
  'POST /helix/streams/markers': 'channel:manage:broadcast',
  'POST /helix/chat/shoutouts': 'moderator:manage:shoutouts',
  'GET /helix/channels/vips': 'channel:read:vips',
  'POST /helix/channels/vips': 'channel:manage:vips',
  'DELETE /helix/channels/vips': 'channel:manage:vips',
  'POST /helix/predictions': 'channel:manage:predictions',
  'PATCH /helix/predictions': 'channel:manage:predictions',
  'GET /helix/channels/followers': 'moderator:read:followers',
  'GET /helix/subscriptions': 'channel:read:subscriptions',
};

export const mockScopes = [
  'moderation:read',
  'channel:manage:broadcast',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'moderator:read:chatters',
  'moderator:manage:shoutouts',
  'moderator:manage:banned_users',
  'moderator:manage:announcements',
  'moderator:manage:warnings',
  'channel:read:vips',
  'channel:manage:vips',
  'channel:manage:moderators',
  'moderator:read:followers',
  'moderator:manage:chat_settings',
  'moderator:manage:chat_messages',
  'channel:read:polls',
  'channel:manage:polls',
  'channel:read:predictions',
  'channel:manage:predictions',
  'channel:read:subscriptions',
  'channel:moderate',
  'clips:edit',
  'user:read:follows',
  'user:write:chat',
  'user:bot',
  'channel:bot',
  'channel:manage:raids',
  'bits:read',
];

export const granted = (core: Core) =>
  mockScopes.filter((s) => !core.data.auth.missingScopes.includes(s));

export async function api(core: Core, req: Request, siteURL: string): Promise<Response> {
  const u = new URL(req.url),
    path = u.pathname,
    method = req.method;

  if (path === '/health') return json({ status: 'ok' });

  if (path === '/oauth2/authorize') {
    const target = new URL('login', siteURL.endsWith('/') ? siteURL : `${siteURL}/`);
    target.searchParams.set('code', 'mock_code_1234567890');

    if (u.searchParams.has('state')) target.searchParams.set('state', u.searchParams.get('state')!);

    return Response.redirect(target, 302);
  }

  if (path === '/oauth2/token' && method === 'POST') {
    const contentType = req.headers.get('content-type') || '';

    const form = contentType.includes('application/x-www-form-urlencoded')
      ? new URLSearchParams(await req.text())
      : new URLSearchParams();

    const param = (key: string) => u.searchParams.get(key) ?? form.get(key);
    const grant = param('grant_type');

    if (grant === 'client_credentials')
      return json({
        access_token: 'mock-app-token',
        token_type: 'bearer',
        expires_in: 99999999,
        scope: [],
      });

    if (grant === 'refresh_token' && param('refresh_token') === 'mock-bot-refresh-token')
      return json({
        access_token: 'mock-bot-token',
        token_type: 'bearer',
        expires_in: 99999999,
        scope: mockScopes,
        refresh_token: 'mock-bot-refresh-token',
      });

    if (grant === 'refresh_token' && core.data.auth.rejectRefresh)
      return json({ status: 400, message: 'Invalid refresh token' }, 400);

    if (grant === 'authorization_code' || grant === 'refresh_token') {
      if (grant === 'authorization_code')
        core.data.auth = { rejectRefresh: false, invalidAccessToken: false, missingScopes: [] };
      else core.data.auth.invalidAccessToken = false;
      core.save();

      return json({
        access_token: `mock-user-token-${id()}`,
        token_type: 'bearer',
        expires_in: 99999999,
        scope: granted(core),
        refresh_token: `mock-user-refresh-${id()}`,
      });
    }

    return json({ error: 'unsupported grant_type' }, 400);
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^\S+\s+/, '');

  if (path === '/oauth2/validate') {
    const bot = token === 'mock-bot-token';

    return json({
      client_id: 'mock',
      login: bot ? 'mockbot' : 'mockstreamer',
      user_id: bot ? '67890' : '12345',
      expires_in: 99999999,
      scopes: bot ? mockScopes : granted(core),
    });
  }

  if (!path.startsWith('/helix/')) return json({ error: 'not found' }, 404);
  let result: Response;

  if (/^mock-user-token(?:-|$)/.test(token) && core.data.auth.invalidAccessToken)
    result = fail(401, 'Unauthorized', 'Invalid OAuth token');
  else if (
    /^mock-user-token(?:-|$)/.test(token) &&
    scopes[`${method} ${path}`] &&
    core.data.auth.missingScopes.includes(scopes[`${method} ${path}`]!)
  )
    result = fail(401, 'Unauthorized', `Missing scope: ${scopes[`${method} ${path}`]}`);
  else result = await helix(core, req, u);
  result.headers.set('Ratelimit-Limit', '800');
  result.headers.set('Ratelimit-Remaining', '799');
  result.headers.set('Ratelimit-Reset', String(Math.floor(Date.now() / 1000) + 60));

  return result;
}

async function helix(core: Core, req: Request, url: URL): Promise<Response> {
  const path = url.pathname,
    method = req.method,
    q = url.searchParams;

  let body: Document = {};

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const raw = await req.text();

    if (raw) {
      try {
        const parsed = JSON.parse(raw);

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          if (path.startsWith('/helix/eventsub/'))
            return fail(400, 'Bad Request', 'invalid JSON body');
        } else body = parsed;
      } catch {
        if (path.startsWith('/helix/eventsub/'))
          return fail(400, 'Bad Request', 'invalid JSON body');
      }
    } else if (path.startsWith('/helix/eventsub/'))
      return fail(400, 'Bad Request', 'invalid JSON body');

    if (
      path === '/helix/eventsub/conduits' &&
      body.shard_count !== undefined &&
      !Number.isInteger(body.shard_count)
    )
      return fail(400, 'Bad Request', 'invalid shard_count');

    if (
      path === '/helix/eventsub/conduits/shards' &&
      ((body.conduit_id !== undefined && typeof body.conduit_id !== 'string') ||
        (body.shards !== undefined && !Array.isArray(body.shards)))
    )
      return fail(400, 'Bad Request', 'invalid shards');

    if (
      path === '/helix/eventsub/subscriptions' &&
      ((body.type !== undefined && typeof body.type !== 'string') ||
        (body.version !== undefined && typeof body.version !== 'string') ||
        (body.condition !== undefined &&
          (!body.condition ||
            typeof body.condition !== 'object' ||
            Array.isArray(body.condition))) ||
        (body.transport !== undefined &&
          (!body.transport || typeof body.transport !== 'object' || Array.isArray(body.transport))))
    )
      return fail(400, 'Bad Request', 'invalid subscription');
  }

  if (path === '/helix/users' && method === 'GET') {
    const ids = q.getAll('id'),
      logins = q.getAll('login');

    if (!ids.length && !logins.length)
      ids.push(req.headers.get('authorization')?.includes('mock-bot-token') ? '67890' : '12345');

    const users = [
      ...ids.map((value) => user(value.trim())),
      ...logins.map((value) => {
        const login = value.trim().replace(/^@/, '').toLowerCase();

        return login === 'mockstreamer'
          ? user('12345')
          : login === 'mockbot'
            ? user('67890')
            : login === 'viewer'
              ? user('99999')
              : user(login, login, login);
      }),
    ].filter((value) => value.id);

    return json({
      data: [
        ...new Map(
          users.map((u) => [
            u.id,
            {
              id: u.id,
              login: u.login,
              display_name: u.name,
              type: '',
              broadcaster_type: u.id === '12345' ? core.data.account.broadcaster_type : '',
              description:
                u.id === '12345'
                  ? core.data.description || 'Mock streamer'
                  : u.id === '67890'
                    ? 'Mock bot'
                    : '',
              profile_image_url: '',
              offline_image_url: '',
              view_count: 0,
              created_at:
                u.id === '12345' || u.id === '67890'
                  ? '2020-01-01T00:00:00Z'
                  : '2021-06-01T00:00:00Z',
            },
          ]),
        ).values(),
      ],
    });
  }

  if (path === '/helix/streams' && method === 'GET')
    return json({
      data: core.data.stream.online
        ? [
            {
              id: 'mock-stream-id',
              user_id: '12345',
              user_login: 'mockstreamer',
              user_name: 'MockStreamer',
              game_id: core.data.stream.game_id,
              game_name: core.data.stream.game_name,
              type: 'live',
              title: core.data.stream.title,
              viewer_count: core.data.stream.viewer_count,
              started_at: core.data.stream.started_at || now(),
              language: 'en',
              thumbnail_url: '',
              delay: 0,
              tag_ids: [],
              tags: [],
              is_mature: false,
            },
          ]
        : [],
    });

  if (path === '/helix/channels' && method === 'GET')
    return json({
      data: [
        {
          broadcaster_id: '12345',
          broadcaster_login: 'mockstreamer',
          broadcaster_name: 'MockStreamer',
          broadcaster_language: 'en',
          game_id: core.data.stream.game_id,
          game_name: core.data.stream.game_name,
          title: core.data.stream.title,
          delay: 0,
        },
      ],
    });

  if (path === '/helix/channels' && method === 'PATCH') {
    Object.assign(core.data.stream, {
      title: body.title ?? core.data.stream.title,
      game_id: body.game_id ?? core.data.stream.game_id,
      game_name:
        body.game_id !== undefined && body.game_id !== core.data.stream.game_id
          ? gameName(body.game_id)
          : core.data.stream.game_name,
    });
    core.broadcast('event', 'channel.update', {
      ...broad,
      title: core.data.stream.title,
      category_id: core.data.stream.game_id,
      category_name: core.data.stream.game_name,
      language: 'en',
      content_classification_labels: [],
    });

    return noContent();
  }

  if (path === '/helix/channels/followers' && method === 'GET') {
    const users = q.get('user_id')
      ? core.data.follows.followed_user_ids.filter((v) => v === q.get('user_id'))
      : core.data.follows.followed_user_ids;

    const limit = Number(q.get('first')) || users.length;

    return json({
      data: users.slice(0, limit).map((v) => ({
        user_id: v,
        user_login: v.toLowerCase(),
        user_name: titleCaseIdentifier(v),
        followed_at: core.data.followedAt[v] || now(),
      })),
      total: core.data.follows.total,
      pagination: {},
    });
  }

  if (path === '/helix/channels/followed' && method === 'GET') {
    const data = core.data.follows.followed_user_ids.map((id) => {
      const target = user(id);

      return {
        broadcaster_id: target.id,
        broadcaster_login: target.login,
        broadcaster_name: target.name,
        followed_at: core.data.followedAt[id] || now(),
      };
    });

    return json({ data, total: data.length, pagination: {} });
  }

  if (path === '/helix/moderation/moderators' && method === 'GET')
    return json({
      data: core.data.moderators.moderator_ids.map((v) => ({
        user_id: v,
        user_login: v === '67890' ? 'mockbot' : `mod_${v.toLowerCase()}`,
        user_name: v === '67890' ? 'MockBot' : `Mod_${titleCaseIdentifier(v)}`,
      })),
      pagination: {},
    });

  if (path === '/helix/eventsub/conduits') {
    if (method === 'GET')
      return json({ data: core.data.conduits.map(({ id, shard_count }) => ({ id, shard_count })) });

    if (method === 'POST') {
      const n = Math.max(1, Number(body.shard_count) || 1);

      const conduit = {
        id: id(),
        shard_count: n,
        shards: Array.from({ length: n }, (_, i) => ({
          id: String(i),
          status: 'enabled',
          transport: { method: 'websocket' },
        })),
      };

      core.data.conduits.push(conduit);
      core.save();

      return json({ data: [{ id: conduit.id, shard_count: n }] });
    }
  }

  if (path === '/helix/eventsub/conduits/shards') {
    const conduit = core.data.conduits.find(
      (c) => c.id === (method === 'GET' ? q.get('conduit_id') : body.conduit_id),
    );

    if (!conduit && method === 'PATCH') return json({ error: 'conduit not found' }, 404);

    if (!conduit)
      return fail(
        method === 'GET' && !q.get('conduit_id') ? 400 : 404,
        method === 'GET' && !q.get('conduit_id') ? 'Bad Request' : 'Not Found',
        method === 'GET' && !q.get('conduit_id') ? 'conduit_id is required' : 'conduit not found',
      );

    if (method === 'GET') return json({ data: conduit.shards, pagination: {} });

    if (method === 'PATCH') {
      const data: Document[] = [],
        errors: Document[] = [];

      for (const next of body.shards ?? []) {
        const shard = conduit.shards.find((s: Document) => s.id === next.id);

        if (!shard)
          errors.push({
            id: next.id,
            message: "The shard id is outside the conduit's range",
            code: 'invalid_parameter',
          });
        else {
          shard.transport = Object.fromEntries(
            Object.entries(next.transport ?? {}).filter(([k]) =>
              ['method', 'callback', 'session_id'].includes(k),
            ),
          );
          data.push(shard);
        }
      }

      core.save();

      return json({ data, errors }, 202);
    }
  }

  if (
    path === '/helix/eventsub/subscriptions' ||
    path.startsWith('/helix/eventsub/subscriptions/')
  ) {
    if (method === 'POST') {
      const type = body.type || '';
      const version = body.version || definition(type)?.version || '1';

      const condition =
        body.condition ??
        clone(
          definition(type, version)?.condition ??
            definition(type)?.condition ?? { broadcaster_user_id: '12345' },
        );

      const transport: Document = Object.fromEntries(
        Object.entries(body.transport ?? {}).filter(
          ([key, value]) =>
            ['method', 'session_id', 'conduit_id', 'callback'].includes(key) && value,
        ),
      );

      transport.method ||= 'websocket';

      const duplicate = core.data.subscriptions.some(
        (sub) =>
          sub.type === type &&
          sub.version === version &&
          isDeepStrictEqual(sub.condition, condition) &&
          isDeepStrictEqual(sub.transport, transport),
      );

      if (duplicate) return fail(409, 'Conflict', 'subscription already exists');

      const sub = {
        id: id(),
        status: 'enabled',
        type,
        version,
        condition,
        transport,
        cost: 0,
        created_at: now(),
      };

      core.data.subscriptions.push(sub);
      core.save();

      return json({ data: [sub], total: 1, total_cost: 1, max_total_cost: 10000 }, 202);
    }

    if (method === 'DELETE') {
      const subId = path.split('/').length > 4 ? path.split('/').at(-1) : q.get('id');

      if (!subId) return fail(400, 'Bad Request', 'subscription id is required');
      const index = core.data.subscriptions.findIndex((s) => s.id === subId);

      if (index < 0) return fail(404, 'Not Found', 'subscription not found');
      core.data.subscriptions.splice(index, 1);
      core.save();

      return noContent();
    }

    if (method === 'GET') {
      const filters = ['status', 'type', 'user_id', 'subscription_id'].filter((k) =>
        q.get(k)?.trim(),
      );

      if (filters.length > 1)
        return fail(400, 'Bad Request', 'only one filter query parameter may be specified');
      const all = [...core.data.subscriptions].sort((a, b) => a.id.localeCompare(b.id));

      const filtered = all.filter(
        (s) =>
          (!q.get('after') || s.id > q.get('after')!) &&
          (!filters.length ||
            (filters[0] === 'subscription_id'
              ? s.id === q.get(filters[0])
              : filters[0] === 'user_id'
                ? Object.values(s.condition).includes(q.get('user_id'))
                : s[filters[0]!] === q.get(filters[0]!))),
      );

      const data = filtered.slice(0, 100);

      return json({
        data,
        total: all.length,
        total_cost: all.reduce((n, s) => n + s.cost, 0),
        max_total_cost: 10000,
        pagination: filtered.length > 100 ? { cursor: data.at(-1)!.id } : {},
      });
    }
  }

  if (path === '/helix/games' && method === 'GET') {
    const byId = q
      .getAll('id')
      .filter(Boolean)
      .map((v) => ({ id: v, name: gameName(v) }));

    const byName = q
      .getAll('name')
      .map((v) =>
        Object.entries(games).find(([, name]) => name.toLowerCase() === v.trim().toLowerCase()),
      )
      .filter((v): v is [string, string] => !!v)
      .map(([id, name]) => ({ id, name }));

    return json({
      data: [
        ...new Map(
          [...byId, ...byName].map((g) => [
            g.id,
            {
              ...g,
              box_art_url: `https://static-cdn.jtvnw.net/ttv-boxart/${g.id}-{width}x{height}.jpg`,
              igdb_id: '',
            },
          ]),
        ).values(),
      ],
    });
  }

  if (path === '/helix/moderation/bans' && method === 'POST') {
    const input = body.data ?? {},
      target = user(input.user_id || 'mock'),
      duration = Math.max(0, Number(input.duration) || 0),
      ends = duration ? new Date(Date.now() + duration * 1000).toISOString() : null;

    const event = {
      ...broad,
      user_id: target.id,
      user_login: target.login,
      user_name: target.name,
      moderator_user_id: '67890',
      moderator_user_login: 'mockbot',
      moderator_user_name: 'MockBot',
      reason: input.reason || '',
      banned_at: now(),
      ends_at: ends,
      is_permanent: duration === 0,
    };

    core.ingest('channel.ban', event);
    core.broadcast('event', 'channel.ban', event);

    return json({
      data: [
        { broadcaster_id: '12345', moderator_id: '67890', user_id: target.id, end_time: ends },
      ],
    });
  }

  if (path === '/helix/moderation/bans' && method === 'DELETE') {
    const target = user(q.get('user_id') || '');

    const event = buildEvent('channel.unban', {
      user_id: target.id,
      user_login: target.login,
      user_name: target.name,
      moderator_user_id: '67890',
    }).event;

    core.ingest('channel.unban', event);
    core.broadcast('event', 'channel.unban', event);

    return noContent();
  }

  if (path === '/helix/moderation/moderators' && ['POST', 'DELETE'].includes(method)) {
    const target = user(q.get('user_id') || body.user_id || '');
    const type = method === 'POST' ? 'channel.moderator.add' : 'channel.moderator.remove';

    const event = buildEvent(type, {
      user_id: target.id,
      user_login: target.login,
      user_name: target.name,
    }).event;

    core.ingest(type, event);
    core.broadcast('event', type, event);

    return noContent();
  }

  if (path === '/helix/channels/vips' && ['POST', 'DELETE'].includes(method)) {
    const target = user(q.get('user_id') || body.user_id || '');
    const type = method === 'POST' ? 'channel.vip.add' : 'channel.vip.remove';

    const event = buildEvent(type, {
      user_id: target.id,
      user_login: target.login,
      user_name: target.name,
    }).event;

    core.ingest(type, event);
    core.broadcast('event', type, event);

    return noContent();
  }

  if (path === '/helix/moderation/banned' && method === 'GET')
    return json({ data: core.docs(path), pagination: {} });

  if (path === '/helix/users' && method === 'PUT') {
    core.data.description = body.description ?? core.data.description;
    core.save();

    return noContent();
  }

  if (path === '/helix/moderation/shield_mode' && method === 'PUT') {
    core.data.shield = !!body.is_active;
    const docs = core.docs(path);

    if (!docs.length) docs.push(templateDoc('update-shield-mode-status'));

    for (const doc of docs) {
      doc.is_active = core.data.shield;
      doc.id ??= id();
    }

    core.broadcast(
      'event',
      body.is_active ? 'channel.shield_mode.begin' : 'channel.shield_mode.end',
      buildEvent(body.is_active ? 'channel.shield_mode.begin' : 'channel.shield_mode.end', {
        moderator_user_id: '67890',
      }).event,
    );

    return noContent();
  }

  if (path === '/helix/chat/messages' && method === 'POST') {
    const sender = user(body.sender_id || '67890');
    const reply = replyFor(core.data.feed, body.reply_parent_message_id || '');
    let text = typeof body.message === 'string' ? body.message : '';

    if (
      reply &&
      !text.toLowerCase().startsWith(`@${String(reply.parent_user_login).toLowerCase()}`)
    ) {
      text = `@${reply.parent_user_login} ${text}`;
    }

    const event = chatMessage(
      { badges: roleBadges(core, sender.id), parse_mentions: false },
      sender,
      text,
      reply,
    );

    core.broadcast('bot', 'channel.chat.message', event);

    return json({ data: [{ message_id: event.message_id, is_sent: true }] });
  }

  if (path === '/helix/chat/announcements' && method === 'POST') {
    const sender = user(q.get('moderator_id') || '67890');

    const event = chatMessage(
      {
        badges: roleBadges(core, sender.id),
        announce: true,
        announce_color: body.color,
        parse_mentions: false,
      },
      sender,
      typeof body.message === 'string' ? body.message : '',
      null,
    );

    core.broadcast('bot', 'channel.chat.notification', event);

    return noContent();
  }

  if (path === '/helix/moderation/chat' && method === 'DELETE') {
    const messageId = q.get('message_id');
    const item = core.data.feed.find((i) => i.data?.message_id === messageId);

    if (messageId && !item) return noContent();
    const target = messageId ? '/admin/chat/delete' : '/admin/chat/clear';
    await admin(
      core,
      new Request(`http://local${target}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(messageId ? { message_id: messageId } : {}),
      }),
    );

    return noContent();
  }

  if (path.startsWith(rewardPath) && !core.data.account.broadcaster_type)
    return fail(403, 'Forbidden', 'The broadcaster must have partner or affiliate status.');

  if (path === rewardPath) {
    if (method === 'GET') {
      seed(core, path, 'get-custom-reward');

      return json({
        data: core.docs(path).filter((r) => !q.get('id') || q.getAll('id').includes(r.id)),
      });
    }

    if (method === 'POST') {
      if (
        body.title &&
        core.docs(path).some((r) => r.title?.toLowerCase() === body.title.toLowerCase())
      )
        return fail(400, 'Bad Request', 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD');
      const validation = validateReward(core, body);

      if (validation) return validation;
      const template = templateDoc('create-custom-rewards');
      delete template.id;
      const value = core.add(path, template);
      applyReward(value, body);
      core.broadcast('event', 'channel.channel_points_custom_reward.add', rewardEvent(value));

      return json({ data: [value] });
    }

    if (method === 'PATCH') {
      const rewardId = q.get('id') || '';

      if (
        body.title &&
        core
          .docs(path)
          .some((r) => r.id !== rewardId && r.title?.toLowerCase() === body.title.toLowerCase())
      ) {
        return fail(400, 'Bad Request', 'UPDATE_CUSTOM_REWARD_DUPLICATE_REWARD');
      }

      let rewards = core.docs(path).filter((r) => !rewardId || r.id === rewardId);

      if (!rewards.length)
        rewards = [
          core.add(path, {
            ...templateDoc('update-custom-reward'),
            ...Object.fromEntries(q.entries()),
          }),
        ];

      for (const reward of rewards) {
        const validation = validateReward(core, body, reward.id);

        if (validation) return validation;
        applyReward(reward, body);
        core.broadcast('event', 'channel.channel_points_custom_reward.update', rewardEvent(reward));
      }

      return json({ data: rewards });
    }

    if (method === 'DELETE') {
      const reward = core.docs(path).find((r) => r.id === q.get('id'));

      if (reward) {
        core.remove(path, { id: reward.id });
        core.broadcast('event', 'channel.channel_points_custom_reward.remove', rewardEvent(reward));
      }

      return noContent();
    }
  }

  if (path === redemptionPath) {
    if (method === 'GET') seed(core, path, 'get-custom-reward-redemption');

    const list = core
      .docs(path)
      .filter(
        (r) =>
          (!q.get('reward_id') || r.reward_id === q.get('reward_id')) &&
          (!q.get('id') || q.getAll('id').includes(r.id)) &&
          (!q.get('status') || r.status === q.get('status')),
      );

    if (method === 'GET') return json({ data: list, pagination: { cursor: '' } });

    if (method === 'PATCH') {
      if (!list.length)
        list.push(
          core.add(path, {
            ...templateDoc('update-redemption-status'),
            ...Object.fromEntries(q.entries()),
          }),
        );

      for (const redemption of list) {
        redemption.status = body.status ?? redemption.status;
        core.broadcast(
          'event',
          'channel.channel_points_custom_reward_redemption.update',
          redemptionEvent(redemption),
        );
      }

      return json({ data: list });
    }
  }

  return generic(core, method, path, q, body);
}

function generic(
  core: Core,
  method: string,
  path: string,
  q: URLSearchParams,
  body: Document,
): Response {
  const op = operations.operations.find((o) => o.method === method && o.path === path) as
    | Document
    | undefined;

  if (!op) return json({ data: [], total: 0, pagination: {} });
  const response: Document = clone(op.response_template ?? {});
  const status = op.success_statuses?.[0] ?? 200;
  const params: Record<string, string> = {};

  for (const [key, value] of q) {
    if (!['first', 'after', 'before'].includes(key) && !(key in params) && value.trim())
      params[key] = value.trim();
  }

  const filters = Object.fromEntries(
    Object.entries(params).filter(([key]) => key === 'id' || key.endsWith('_id')),
  );

  const docs = core.docs(path);

  if (method === 'GET') {
    if (!docs.length && Array.isArray(response.data)) {
      for (const template of response.data) {
        if (template && typeof template === 'object' && !Array.isArray(template)) {
          const doc = freshTemplate(template);

          if (!('broadcaster_id' in doc) && !('broadcaster_user_id' in doc))
            doc.broadcaster_id = '12345';
          docs.push(doc);
        }
      }
    }

    const found = docs.filter((doc) => match(doc, params));
    const first = Number.parseInt(q.get('first') || '', 10);
    const size = first > 0 ? Math.min(first, 100) : response.pagination ? 20 : found.length;
    const after = Number.parseInt(q.get('after') || '', 10);
    const offset = after > 0 ? Math.min(after, found.length) : 0;
    response.data = clone(found.slice(offset, offset + size));

    if (response.pagination)
      response.pagination = { cursor: offset + size < found.length ? String(offset + size) : '' };
    core.save();

    return json(response);
  }

  if (method === 'DELETE') {
    helixHook(core, op.slug, undefined, body, filters);

    if (Object.keys(filters).length) core.remove(path, filters);
    core.save();

    return status === 204 ? noContent() : json(response, status);
  }

  const action = actions.has(op.slug);

  const update =
    !action &&
    (method === 'PATCH' ||
      method === 'PUT' ||
      /^(Update|Modify|Set|Resolve|Assign|Edit|End)/i.test(op.name));

  const create = !action && method === 'POST' && /^(Create|Add|Block|Ban|Pin)/i.test(op.name);

  if (create) {
    const template = freshTemplate(Array.isArray(response.data) ? (response.data[0] ?? {}) : {});
    delete template.id;
    merge(template, body);
    template.broadcaster_id ||= '12345';
    const doc = core.add(path, template);
    response.data = [doc];
    helixHook(core, op.slug, doc, body, filters);
  } else if (update) {
    let selected = docs.filter((doc) => match(doc, filters));

    if (!selected.length) {
      const fallback = freshTemplate(Array.isArray(response.data) ? (response.data[0] ?? {}) : {});
      selected = [core.add(path, fallback)];
    }

    for (const doc of selected) {
      merge(doc, { ...params, ...body });
      doc.id ||= id();
      helixHook(core, op.slug, doc, { ...params, ...body }, filters);
    }

    response.data = clone(selected);
  } else {
    if (Object.keys(body).length) {
      if (
        'data' in body &&
        !(
          Array.isArray(response.data) &&
          response.data[0] &&
          typeof body.data === 'object' &&
          !Array.isArray(body.data)
        )
      )
        response.data = clone(body.data);
      else if (
        Array.isArray(response.data) &&
        response.data[0] &&
        typeof response.data[0] === 'object'
      )
        merge(
          response.data[0],
          body.data && typeof body.data === 'object' && !Array.isArray(body.data)
            ? body.data
            : body,
        );
      else merge(response, body);
    }

    helixHook(core, op.slug, undefined, body, params);
  }

  core.save();

  return status === 204 ? noContent() : json(response, status);
}

function freshTemplate(template: Document): Document {
  const result = clone(template);

  const refresh = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) refresh(item);

      return;
    }

    if (!value || typeof value !== 'object') return;

    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith('_at') && typeof item === 'string') (value as Document)[key] = now();
      else refresh(item);
    }
  };

  refresh(result);

  return result;
}

function templateDoc(slug: string): Document {
  const op = operations.operations.find((v) => v.slug === slug);
  const template = (op?.response_template as Document | null)?.data;

  return clone(Array.isArray(template) ? (template[0] ?? {}) : {});
}

function seed(core: Core, path: string, slug: string) {
  if (!core.docs(path).length) {
    const doc = templateDoc(slug);

    if (Object.keys(doc).length) core.docs(path).push(doc);
    core.save();
  }
}

const games: Record<string, string> = {
  '509658': 'Just Chatting',
  '21779': 'League of Legends',
  '32982': 'Grand Theft Auto V',
  '27471': 'Minecraft',
  '516575': 'VALORANT',
  '33214': 'Fortnite',
  '32399': 'Counter-Strike',
  '29595': 'Dota 2',
  '26936': 'Music',
  '509660': 'Art',
  '509670': 'Science & Technology',
  '509659': 'ASMR',
};

function gameName(id: string) {
  return id ? (games[id] ?? `Category ${id}`) : '';
}

function titleCaseIdentifier(value: string) {
  return value
    .toLowerCase()
    .replace(
      /(^|[_\- ])([a-z])/g,
      (_, prefix: string, letter: string) => prefix + letter.toUpperCase(),
    );
}

function roleBadges(core: Core, userId: string): Document[] {
  const badges: Document[] = [];

  if (userId === '12345') badges.push({ set_id: 'broadcaster', id: '1', info: '' });

  if (core.data.moderators.moderator_ids.includes(userId))
    badges.push({ set_id: 'moderator', id: '1', info: '' });

  return badges;
}
