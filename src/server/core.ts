import { Storage, type Document } from './storage';
import catalog from '../data/payloads.json';

export const broad = {
  broadcaster_user_id: '12345',
  broadcaster_user_login: 'mockstreamer',
  broadcaster_user_name: 'MockStreamer',
};

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

function safeCopy(value: any): any {
  if (Array.isArray(value)) return value.map(safeCopy);

  if (value && typeof value === 'object') return merge({}, value);

  return value;
}

export function merge(target: Document, source: Document): Document {
  for (const [key, value] of Object.entries(source)) {
    if (unsafeKeys.has(key)) continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current =
        Object.hasOwn(target, key) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
          ? target[key]
          : {};

      target[key] = merge(current, value);
    } else if (Array.isArray(value)) {
      target[key] = value.map(safeCopy);
    } else target[key] = value;
  }

  return target;
}

export function definition(type: string, version?: string): Document | undefined {
  const found = catalog.entries.filter((e) => e.type === type);

  return (
    version
      ? found.find((e) => e.version === version)
      : found.sort((a, b) =>
          a.version === 'beta' ? 1 : b.version === 'beta' ? -1 : b.version.localeCompare(a.version),
        )[0]
  ) as Document | undefined;
}

export function buildEvent(type: string, body: Document, version?: string) {
  const d =
    definition(type, version) ??
    (version ? catalog.entries.find((entry) => entry.type === type) : undefined);

  const event = clone(d?.event ?? {});

  const refresh = (value: any) => {
    if (!value || typeof value !== 'object') return;

    for (const key of Object.keys(value)) {
      if (key.endsWith('_at') && typeof value[key] === 'string') value[key] = now();
      else refresh(value[key]);
    }
  };

  refresh(event);

  return {
    version: d?.version ?? (version?.trim() || '1'),
    event: merge(event, body),
  };
}

export const eventCatalog = () =>
  catalog.entries.map(({ event: _event, ...entry }) => ({
    ...entry,
    payload: buildEvent(entry.type, {}, entry.version).event,
  }));

export function user(userId: string, login = '', name = '') {
  if (userId === '12345') return { id: userId, login: 'mockstreamer', name: 'MockStreamer' };

  if (userId === '67890') return { id: userId, login: 'mockbot', name: 'MockBot' };

  if (userId === '99999' && !login && !name) return { id: userId, login: 'viewer', name: 'Viewer' };
  const l = login || userId.trim().toLowerCase();

  return { id: userId, login: l, name: name || l };
}

export function match(doc: Document, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(
    ([k, v]) =>
      !v ||
      String(doc[k] ?? '') === v ||
      (k === 'id' && [doc.reward_id, doc.message_id].includes(v)) ||
      (k.endsWith('_id') && doc[k.replace(/_id$/, '_login')] === v),
  );
}

function apiDocument(value: any): any {
  if (Array.isArray(value)) return value.map(apiDocument);

  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key.replace(/_user_(id|login|name)$/, '_$1'),
      apiDocument(nested),
    ]),
  );
}

function rewardSetting(value: Document | undefined, sourceKey: string, targetKey: string) {
  return {
    is_enabled: value?.is_enabled === true,
    [targetKey]: Number(value?.[sourceKey]) || 0,
  };
}

export class Core {
  storage: Storage;
  listeners = new Set<(item: Document) => void>();
  sockets = new Map<string, any>();
  constructor(storage: Storage) {
    this.storage = storage;
  }
  get data() {
    return this.storage.data;
  }
  save() {
    this.storage.save();
  }
  docs(path: string) {
    return (this.data.documents[path] ??= []);
  }
  add(path: string, doc: Document) {
    const item = { id: id(), ...clone(doc) };
    this.docs(path).push(item);

    return item;
  }
  upsert(path: string, doc: Document) {
    const existing = this.docs(path).find((d) => d.id === doc.id);

    if (existing) return merge(existing, doc);

    return this.add(path, doc);
  }
  remove(path: string, filters: Record<string, string>) {
    if (!Object.keys(filters).length) return [];
    const list = this.docs(path);
    const found = list.filter((d) => match(d, filters));
    this.data.documents[path] = list.filter((d) => !match(d, filters));

    return found;
  }
  broadcast(source: string, type: string, event: Document, requestedVersion?: string) {
    const item = {
      id: id(),
      source,
      event_type: type,
      at: now(),
      data: clone(event),
    };

    this.data.feed.push(item);
    this.data.feed = this.data.feed.slice(-300);
    this.save();

    for (const listener of this.listeners) listener(item);

    const active = new Set(
      this.data.conduits.flatMap((c) =>
        (c.shards ?? []).map((s: Document) => s.transport?.session_id).filter(Boolean),
      ),
    );

    const sub = this.data.subscriptions.find(
      (s) => s.type === type && (!requestedVersion || s.version === requestedVersion),
    );

    const def = definition(type, requestedVersion ?? sub?.version);

    for (const [sessionId, ws] of this.sockets) {
      if (active.size && !active.has(sessionId)) continue;
      const version = requestedVersion ?? sub?.version ?? def?.version ?? '1';

      const subscription = {
        id: sub?.id ?? id(),
        status: 'enabled',
        type,
        version,
        cost: sub?.cost ?? 0,
        condition: sub?.condition ?? def?.condition ?? { broadcaster_user_id: '12345' },
        created_at: sub?.created_at ?? now(),
        transport: { method: 'websocket', session_id: sessionId },
      };

      try {
        ws.send(
          JSON.stringify({
            metadata: {
              message_id: id(),
              message_type: 'notification',
              message_timestamp: now(),
              subscription_type: type,
              subscription_version: version,
            },
            payload: { subscription, event },
          }),
        );
      } catch {
        this.sockets.delete(sessionId);
      }
    }

    return item;
  }
  ingest(type: string, event: Document) {
    if (type === 'stream.online' || type === 'stream.offline') {
      if (type === 'stream.online' && !this.data.stream.online) this.data.stream.started_at = now();
      this.data.stream.online = type === 'stream.online';
    }

    if (type === 'channel.update')
      Object.assign(this.data.stream, {
        title: event.title ?? this.data.stream.title,
        game_id: event.category_id ?? this.data.stream.game_id,
        game_name: event.category_name ?? this.data.stream.game_name,
      });

    if (type === 'channel.follow' && event.user_id) {
      if (!this.data.follows.followed_user_ids.includes(event.user_id))
        this.data.follows.followed_user_ids.push(event.user_id);
      this.data.followedAt[event.user_id] = now();
      this.data.follows.total++;
    }

    if (type.startsWith('channel.moderator.') && event.user_id) {
      const mods = this.data.moderators.moderator_ids;

      if (type.endsWith('.add') && !mods.includes(event.user_id)) mods.push(event.user_id);

      if (type.endsWith('.remove') && event.user_id !== '67890')
        this.data.moderators.moderator_ids = mods.filter((v) => v !== event.user_id);
    }

    if (type.startsWith('channel.shield_mode.')) this.data.shield = type.endsWith('.begin');

    if (
      [
        'channel.subscribe',
        'channel.subscription.end',
        'channel.subscription.gift',
        'channel.subscription.message',
      ].includes(type)
    ) {
      const chatter = user(event.user_id || '');
      const tier = Number.parseInt(String(event.tier ?? ''), 10);
      this.add('/helix/subscriptions', {
        broadcaster_id: '12345',
        broadcaster_login: 'mockstreamer',
        broadcaster_name: 'MockStreamer',
        gifter_id: '',
        gifter_login: '',
        gifter_name: '',
        is_gift: event.is_gift ?? null,
        plan_name: 'Channel Subscription',
        tier: String(Number.isNaN(tier) ? 1000 : tier),
        user_id: chatter.id,
        user_login: chatter.login,
        user_name: chatter.name,
      });
    }

    if (type === 'channel.ban') {
      const chatter = user(event.user_id || '');
      const bans = this.docs('/helix/moderation/banned');

      const ban = {
        user_id: chatter.id,
        user_login: chatter.login,
        user_name: chatter.name,
        reason: event.reason || '',
        banned_at: now(),
        ends_at:
          typeof event.ends_at === 'string' && !Number.isNaN(Date.parse(event.ends_at))
            ? event.ends_at
            : null,
      };

      const existing = bans.find((b) => b.user_id === chatter.id);

      if (existing) Object.assign(existing, ban);
      else bans.push(ban);
    }

    if (type === 'channel.unban' && event.user_id)
      this.remove('/helix/moderation/banned', { user_id: event.user_id });

    if (type === 'channel.vip.add') this.add('/helix/channels/vips', event);

    if (type === 'channel.vip.remove' && event.user_id)
      this.remove('/helix/channels/vips', { user_id: event.user_id });
    const rewardPath = '/helix/channel_points/custom_rewards';

    if (type === 'channel.channel_points_custom_reward.remove' && event.id)
      this.remove(rewardPath, { id: event.id });

    if (
      [
        'channel.channel_points_custom_reward.add',
        'channel.channel_points_custom_reward.update',
      ].includes(type)
    ) {
      const document = apiDocument(event);
      document.broadcaster_id ??= '12345';
      document.max_per_stream_setting = rewardSetting(
        document.max_per_stream,
        'value',
        'max_per_stream',
      );
      document.max_per_user_per_stream_setting = rewardSetting(
        document.max_per_user_per_stream,
        'value',
        'max_per_user_per_stream',
      );
      document.global_cooldown_setting = rewardSetting(
        document.global_cooldown,
        'seconds',
        'global_cooldown_seconds',
      );
      delete document.max_per_stream;
      delete document.max_per_user_per_stream;
      delete document.global_cooldown;

      if (document.id) this.upsert(rewardPath, document);
    }

    if (
      [
        'channel.channel_points_custom_reward_redemption.add',
        'channel.channel_points_custom_reward_redemption.update',
      ].includes(type)
    ) {
      const document = apiDocument(event);
      document.broadcaster_id ??= '12345';

      if (document.reward?.id) document.reward_id = document.reward.id;

      if (typeof document.status === 'string') document.status = document.status.toUpperCase();

      if (document.id) this.upsert(`${rewardPath}/redemptions`, document);
    }

    const eventPaths: Record<string, string> = {
      'channel.poll.begin': '/helix/polls',
      'channel.poll.progress': '/helix/polls',
      'channel.poll.end': '/helix/polls',
      'channel.prediction.begin': '/helix/predictions',
      'channel.prediction.progress': '/helix/predictions',
      'channel.prediction.lock': '/helix/predictions',
      'channel.prediction.end': '/helix/predictions',
    };

    const path = eventPaths[type];

    if (path) {
      const document = apiDocument(event);
      document.broadcaster_id ??= '12345';

      if (document.id) this.upsert(path, document);
      else this.add(path, document);
    }

    this.save();
  }
}
