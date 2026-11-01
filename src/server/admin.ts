import { Core, broad, buildEvent, eventCatalog, id, now, user } from './core';
import type { Document } from './storage';
import { chatMessage, chatUser, replyFor } from './chat';
import operations from '../data/operations.json';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (message: string, status = 400) => json({ error: message }, status);
const rewardPath = '/helix/channel_points/custom_rewards';
const redemptionPath = `${rewardPath}/redemptions`;

const fieldTypes: Record<string, Record<string, 'string' | 'boolean' | 'integer' | 'strings'>> = {
  '/admin/state/stream': {
    online: 'boolean',
    title: 'string',
    game_id: 'string',
    game_name: 'string',
    viewer_count: 'integer',
  },
  '/admin/state/follows': { total: 'integer', followed_user_ids: 'strings' },
  '/admin/state/moderators': { moderator_ids: 'strings' },
  '/admin/state/account': { broadcaster_type: 'string' },
  '/admin/state/auth': {
    rejectRefresh: 'boolean',
    invalidAccessToken: 'boolean',
    missingScopes: 'strings',
  },
  '/admin/chat/delete': { message_id: 'string' },
  '/admin/chat/clear-user': {
    user_id: 'string',
    user_login: 'string',
    user_name: 'string',
  },
  '/admin/rewards/redeem': {
    reward_id: 'string',
    user_id: 'string',
    user_input: 'string',
  },
  '/admin/rewards/delete': { id: 'string' },
  '/admin/rewards/redemption-status': {
    reward_id: 'string',
    redemption_id: 'string',
    status: 'string',
  },
};

const rewardFields: Record<string, 'string' | 'boolean' | 'integer'> = {
  id: 'string',
  title: 'string',
  prompt: 'string',
  cost: 'integer',
  background_color: 'string',
  is_enabled: 'boolean',
  is_user_input_required: 'boolean',
  is_max_per_stream_enabled: 'boolean',
  max_per_stream: 'integer',
  is_max_per_user_per_stream_enabled: 'boolean',
  max_per_user_per_stream: 'integer',
  is_global_cooldown_enabled: 'boolean',
  global_cooldown_seconds: 'integer',
  should_redemptions_skip_request_queue: 'boolean',
};

function invalidField(body: Document, fields: Record<string, string>) {
  return Object.entries(fields).find(([key, type]) => {
    const value = body[key];

    if (value == null) return false;

    if (type === 'strings')
      return !Array.isArray(value) || value.some((item) => typeof item !== 'string');

    if (type === 'integer') return !Number.isInteger(value);

    return typeof value !== type;
  })?.[0];
}

function rewardTemplate(): Document {
  const operation = operations.operations.find((item) => item.slug === 'get-custom-reward');

  const data = (operation?.response_template as Document | undefined)?.data;

  return structuredClone(Array.isArray(data) ? (data[0] ?? {}) : {});
}

export async function admin(core: Core, req: Request): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;

  let body: Document = {};

  if (method === 'POST') {
    const raw = await req.text();

    try {
      const parsed = raw
        ? JSON.parse(raw)
        : path.startsWith('/admin/trigger/') ||
            ['/admin/chat/clear', '/admin/chat/history/clear'].includes(path)
          ? {}
          : null;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return err('invalid JSON body');
      body = parsed;
    } catch {
      return err('invalid JSON body');
    }
  }

  if (method === 'POST') {
    const fields =
      path === '/admin/rewards' || path === '/admin/rewards/update'
        ? rewardFields
        : fieldTypes[path];

    const invalid = fields && invalidField(body, fields);

    if (invalid) return err(`invalid ${invalid}`);
  }

  if (path === '/admin/catalog/events' && method === 'GET') {
    const data = eventCatalog();

    return json({ total: data.length, data });
  }

  if (path.startsWith('/admin/state/')) {
    const key = path.slice('/admin/state/'.length);

    if (!['stream', 'follows', 'moderators', 'account', 'auth'].includes(key))
      return err('not found', 404);
    const state: Document = core.data;

    if (method === 'POST') {
      if (key === 'stream') {
        const started_at = body.online
          ? state.stream.online
            ? state.stream.started_at
            : now()
          : undefined;

        state.stream = {
          online: !!body.online,
          title: body.title ?? '',
          game_id: body.game_id || '',
          game_name: body.game_name || '',
          viewer_count: Math.max(0, Number(body.viewer_count) || 0),
          ...(started_at ? { started_at } : {}),
        };
      }

      if (
        key === 'follows' &&
        body.followed_user_ids != null &&
        (!Array.isArray(body.followed_user_ids) ||
          body.followed_user_ids.some((v: unknown) => typeof v !== 'string'))
      )
        return err('invalid followed_user_ids');

      if (
        key === 'moderators' &&
        body.moderator_ids != null &&
        (!Array.isArray(body.moderator_ids) ||
          body.moderator_ids.some((v: unknown) => typeof v !== 'string'))
      )
        return err('invalid moderator_ids');

      if (
        key === 'auth' &&
        body.missingScopes != null &&
        (!Array.isArray(body.missingScopes) ||
          body.missingScopes.some((v: unknown) => typeof v !== 'string'))
      )
        return err('invalid missingScopes');

      if (key === 'follows') {
        const ids = [
          ...new Set<string>([
            '67890',
            ...(body.followed_user_ids ?? []).map((v: string) => v.trim()).filter(Boolean),
          ]),
        ].sort();

        state.followedAt = Object.fromEntries(
          ids.map((id) => [id, id === '67890' ? state.followedAt[id] || now() : now()]),
        );
        state.follows = {
          total: Math.max(0, Number(body.total) || 0),
          followed_user_ids: ids,
        };
      }

      if (key === 'moderators')
        state.moderators = {
          moderator_ids: [
            ...new Set([
              '67890',
              ...(body.moderator_ids ?? []).map((v: string) => v.trim()).filter(Boolean),
            ]),
          ].sort(),
        };

      if (key === 'auth')
        state.auth = {
          rejectRefresh: !!body.rejectRefresh,
          invalidAccessToken: !!body.invalidAccessToken,
          missingScopes: [
            ...new Set((body.missingScopes ?? []).map((v: string) => v.trim()).filter(Boolean)),
          ].sort(),
        };

      if (key === 'account') {
        body.broadcaster_type = (body.broadcaster_type ?? '').trim().toLowerCase();

        if (!['', 'none', 'affiliate', 'partner'].includes(body.broadcaster_type))
          return err('unknown broadcaster type');
        state.account.broadcaster_type =
          body.broadcaster_type === 'none' ? '' : body.broadcaster_type;
      }

      core.save();
    }

    if (key === 'stream') {
      const { started_at: _startedAt, ...stream } = state.stream;

      return json(stream);
    }

    return json(
      key === 'account'
        ? { ...state.account, affiliate: state.account.broadcaster_type !== '' }
        : state[key],
    );
  }

  if (path.startsWith('/admin/trigger/') && method === 'POST') {
    const type = decodeURIComponent(path.slice('/admin/trigger/'.length));
    const requestedVersion = url.searchParams.get('version') || undefined;
    const { event, version } = buildEvent(type, body, requestedVersion);
    core.ingest(type, event);
    core.broadcast('event', type, event, requestedVersion ? version : undefined);

    return json({ status: 'ok', event_type: type, version, event });
  }

  if (path.startsWith('/admin/rewards')) {
    const rewards = core.docs(rewardPath),
      redemptions = core.docs(redemptionPath);

    if (path === '/admin/rewards' && method === 'GET') {
      if (!rewards.length) {
        rewards.push(rewardTemplate());
        core.save();
      }

      return json({
        data: rewards,
        total: rewards.length,
        affiliate: !!core.data.account.broadcaster_type,
        broadcaster_type: core.data.account.broadcaster_type,
      });
    }

    if (path === '/admin/rewards/redemptions' && method === 'GET') {
      const rewardId = url.searchParams.get('reward_id');

      const data = rewardId ? redemptions.filter((r) => r.reward_id === rewardId) : redemptions;

      return json({ data, total: data.length });
    }

    if (!core.data.account.broadcaster_type)
      return err('broadcaster must be an affiliate or partner', 409);

    if (path === '/admin/rewards' && method === 'POST') {
      const result = createReward(core, body);

      if (result instanceof Response) return result;

      return json({ data: result });
    }

    if (path === '/admin/rewards/update') {
      if (!body.id?.trim()) return err('id is required');
      body.id = body.id.trim();
      const reward = rewards.find((r) => r.id === body.id);

      if (!reward) return err('reward not found', 404);
      const valid = validateReward(core, body, reward.id);

      if (valid) return valid;
      applyReward(reward, body);
      core.broadcast('event', 'channel.channel_points_custom_reward.update', rewardEvent(reward));

      return json({ data: reward });
    }

    if (path === '/admin/rewards/delete') {
      const reward = rewards.find((r) => r.id === body.id);

      if (!reward) return err('reward not found', 404);
      core.remove(rewardPath, { id: body.id });
      core.broadcast('event', 'channel.channel_points_custom_reward.remove', rewardEvent(reward));

      return json({ data: reward, deleted: true });
    }

    if (path === '/admin/rewards/redeem') {
      const reward = rewards.find((r) => r.id === body.reward_id);

      if (!reward) return err('reward not found', 404);
      const u = user(body.user_id || '99999');

      const redemption = core.add(redemptionPath, {
        broadcaster_id: '12345',
        broadcaster_login: 'mockstreamer',
        broadcaster_name: 'MockStreamer',
        reward_id: reward.id,
        reward: {
          id: reward.id,
          title: reward.title,
          prompt: reward.prompt,
          cost: reward.cost,
        },
        user_id: u.id,
        user_login: u.login,
        user_name: u.name,
        user_input: body.user_input || '',
        status: 'UNFULFILLED',
        redeemed_at: now(),
      });

      core.broadcast(
        'event',
        'channel.channel_points_custom_reward_redemption.add',
        redemptionEvent(redemption),
      );

      return json({ data: redemption });
    }

    if (path === '/admin/rewards/redemption-status') {
      body.status = String(body.status ?? '')
        .trim()
        .toUpperCase();

      if (!['FULFILLED', 'CANCELED'].includes(body.status)) return err('invalid redemption status');

      const redemption = redemptions.find(
        (r) => r.id === body.redemption_id && r.reward_id === body.reward_id,
      );

      if (!redemption) return err('redemption not found', 404);
      redemption.status = body.status;
      core.broadcast(
        'event',
        'channel.channel_points_custom_reward_redemption.update',
        redemptionEvent(redemption),
      );

      return json({ data: redemption });
    }
  }

  if (path === '/admin/chat/history' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit'));

    return json({
      items: limit > 0 ? core.data.feed.slice(-limit) : core.data.feed,
    });
  }

  if (path === '/admin/chat/stream' && method === 'GET') return sse(core, req);

  if (path === '/admin/chat/history/clear' && method === 'POST') {
    core.data.feed = [];
    core.save();

    return json({ status: 'ok' });
  }

  if (path === '/admin/chat/messages' && method === 'POST') {
    for (const key of [
      'user_id',
      'user_login',
      'user_name',
      'message',
      'color',
      'message_type',
      'reply_to_message_id',
      'channel_points_custom_reward_id',
      'announce_color',
    ]) {
      if (body[key] != null && typeof body[key] !== 'string') return err(`invalid ${key}`);
    }

    if (body.bits != null && !Number.isInteger(body.bits)) return err('invalid bits');

    if (body.announce != null && typeof body.announce !== 'boolean') return err('invalid announce');

    if (
      body.badges != null &&
      (!Array.isArray(body.badges) ||
        body.badges.some(
          (b: unknown) =>
            !b ||
            typeof b !== 'object' ||
            Array.isArray(b) ||
            Object.values(b).some((v) => v != null && typeof v !== 'string'),
        ))
    )
      return err('invalid badges');

    if (!body.message?.trim()) return err('message is required');

    if (!body.user_id?.trim()) return err('user_id is required');

    const chatter = chatUser(body.user_id.trim(), body.user_login, body.user_name);

    let text = body.message.trim();
    let reply: Document | null = null;

    if (body.reply_to_message_id) {
      reply = replyFor(core.data.feed, body.reply_to_message_id.trim());

      if (!reply) return err('reply target message not found', 404);

      if (reply.parent_user_login && !text.startsWith('@'))
        text = `@${reply.parent_user_login} ${text}`;
    }

    const event = chatMessage(body, chatter, text, reply);

    return json({
      item: core.broadcast(
        'user',
        body.announce ? 'channel.chat.notification' : 'channel.chat.message',
        event,
      ),
    });
  }

  if (path === '/admin/chat/delete' && method === 'POST') {
    body.message_id = body.message_id?.trim();

    if (!body.message_id) return err('message_id is required');

    const item = core.data.feed.find((i) => i.data?.message_id === body.message_id);

    if (!item) return err('message not found', 404);
    core.data.feed = core.data.feed.filter(
      (i) => i.event_type !== 'channel.chat.message' || i.data?.message_id !== body.message_id,
    );
    const d = item.data;

    return json({
      item: core.broadcast('event', 'channel.chat.message_delete', {
        ...broad,
        target_user_id: d.chatter_user_id,
        target_user_login: d.chatter_user_login,
        target_user_name: d.chatter_user_name,
        message_id: body.message_id,
      }),
    });
  }

  if (path === '/admin/chat/clear' && method === 'POST') {
    core.data.feed = core.data.feed.filter((i) => i.event_type !== 'channel.chat.message');

    return json({
      item: core.broadcast('event', 'channel.chat.clear', { ...broad }),
    });
  }

  if (path === '/admin/chat/clear-user' && method === 'POST') {
    if (!body.user_id?.trim()) return err('user_id is required');
    const u = chatUser(body.user_id.trim(), body.user_login, body.user_name);
    core.data.feed = core.data.feed.filter(
      (i) => i.data?.chatter_user_id !== u.id || i.event_type !== 'channel.chat.message',
    );

    return json({
      item: core.broadcast('event', 'channel.chat.clear_user_messages', {
        ...broad,
        target_user_id: u.id,
        target_user_login: u.login,
        target_user_name: u.name,
      }),
    });
  }

  return err('not found', 404);
}

function sse(core: Core, req: Request) {
  const encoder = new TextEncoder();
  let listener: ((item: Document) => void) | undefined;
  let timer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          if (listener) core.listeners.delete(listener);
          clearInterval(timer);
        }
      };

      listener = (item) => write(`id: ${item.id}\nevent: feed\ndata: ${JSON.stringify(item)}\n\n`);
      core.listeners.add(listener);
      write('retry: 2000\n\n');

      const last =
        req.headers.get('last-event-id')?.trim() ||
        new URL(req.url).searchParams.get('last_event_id')?.trim();

      if (last) {
        const index = core.data.feed.findIndex((i) => i.id === last);

        for (const item of core.data.feed.slice(index + 1)) listener(item);
      }

      timer = setInterval(() => write(': ping\n\n'), 15000);
      req.signal.addEventListener(
        'abort',
        () => {
          if (listener) core.listeners.delete(listener);
          clearInterval(timer);

          try {
            controller.close();
          } catch {}
        },
        { once: true },
      );
    },
    cancel() {
      if (listener) core.listeners.delete(listener);
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

export function validateReward(core: Core, input: Document, exclude = ''): Response | undefined {
  if (input.cost !== undefined && (Number(input.cost) <= 0 || Number(input.cost) > 2000000))
    return err('cost must be positive');

  if (
    input.title &&
    core
      .docs(rewardPath)
      .some((r) => r.id !== exclude && r.title.toLowerCase() === input.title.toLowerCase())
  )
    return err('reward title already exists');
}

export function createReward(core: Core, input: Document): Document | Response {
  if (!input.title?.trim()) return err('title is required');

  if (!input.cost || Number(input.cost) <= 0 || Number(input.cost) > 2000000)
    return err('cost must be positive');
  const validation = validateReward(core, input);

  if (validation) return validation;

  const reward = core.add(rewardPath, {
    ...rewardTemplate(),
    id: id(),
    title: input.title.trim(),
    cost: input.cost,
    image: null,
  });

  applyReward(reward, input);
  core.broadcast('event', 'channel.channel_points_custom_reward.add', rewardEvent(reward));

  return reward;
}

export function applyReward(reward: Document, input: Document) {
  const flat = [
    'is_max_per_stream_enabled',
    'max_per_stream',
    'is_max_per_user_per_stream_enabled',
    'max_per_user_per_stream',
    'is_global_cooldown_enabled',
    'global_cooldown_seconds',
  ];

  for (const [k, v] of Object.entries(input))
    if (
      !flat.includes(k) &&
      k !== 'id' &&
      Object.hasOwn(rewardFields, k) &&
      v != null &&
      !(k === 'title' && !String(v).trim())
    )
      reward[k] = k === 'title' ? String(v).trim() : v;

  for (const [enabled, value, setting, settingValue] of [
    ['is_max_per_stream_enabled', 'max_per_stream', 'max_per_stream_setting', 'max_per_stream'],
    [
      'is_max_per_user_per_stream_enabled',
      'max_per_user_per_stream',
      'max_per_user_per_stream_setting',
      'max_per_user_per_stream',
    ],
    [
      'is_global_cooldown_enabled',
      'global_cooldown_seconds',
      'global_cooldown_setting',
      'global_cooldown_seconds',
    ],
  ]) {
    reward[setting] ??= { is_enabled: false, [settingValue]: 0 };

    if (enabled in input) reward[setting].is_enabled = input[enabled];

    if (value in input) reward[setting][settingValue] = input[value];
  }

  for (const key of flat) delete reward[key];
}

export function rewardEvent(reward: Document) {
  const event: Document = {
    ...reward,
    ...broad,
    max_per_stream: {
      is_enabled: reward.max_per_stream_setting?.is_enabled ?? false,
      value: reward.max_per_stream_setting?.max_per_stream ?? 0,
    },
    max_per_user_per_stream: {
      is_enabled: reward.max_per_user_per_stream_setting?.is_enabled ?? false,
      value: reward.max_per_user_per_stream_setting?.max_per_user_per_stream ?? 0,
    },
    global_cooldown: {
      is_enabled: reward.global_cooldown_setting?.is_enabled ?? false,
      seconds: reward.global_cooldown_setting?.global_cooldown_seconds ?? 0,
    },
  };

  for (const key of [
    'broadcaster_id',
    'broadcaster_login',
    'broadcaster_name',
    'max_per_stream_setting',
    'max_per_user_per_stream_setting',
    'global_cooldown_setting',
  ])
    delete event[key];

  return event;
}

export function redemptionEvent(redemption: Document) {
  const event = structuredClone(redemption);
  event.status = String(event.status ?? '').toLowerCase();

  if (event.reward && typeof event.reward === 'object') {
    delete event.reward.broadcaster_name;
    delete event.reward.broadcaster_login;
    event.reward.broadcaster_user_id = event.reward.broadcaster_id || '12345';
  }

  return { ...event, ...broad };
}
