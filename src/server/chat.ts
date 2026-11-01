import { broad, id, user } from './core';
import type { Document } from './storage';

const colors = [
  '#FF0000',
  '#0000FF',
  '#00FF00',
  '#B22222',
  '#FF7F50',
  '#9ACD32',
  '#FF4500',
  '#2E8B57',
  '#DAA520',
  '#D2691E',
  '#5F9EA0',
  '#1E90FF',
  '#FF69B4',
  '#8A2BE2',
  '#00FF7F',
];

export function chatUser(userId: string, login = '', name = '') {
  const fallback = user(userId);

  return {
    id: userId,
    login: login.trim() || fallback.login,
    name: name.trim() || login.trim() || fallback.login,
  };
}

export function chatColor(login: string) {
  if (!login) return colors[0];
  let hash = 2166136261;

  for (const byte of new TextEncoder().encode(login)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;

  return colors[hash % colors.length];
}

export function messagePayload(text: string) {
  const fragments: Document[] = [];
  let offset = 0;

  for (const match of text.matchAll(/@([a-zA-Z0-9_]+)/g)) {
    if (match.index > offset)
      fragments.push({ type: 'text', text: text.slice(offset, match.index) });
    const login = match[1]!.toLowerCase();

    const mentioned =
      login === 'mockstreamer'
        ? user('12345')
        : login === 'mockbot'
          ? user('67890')
          : login === 'viewer'
            ? user('99999')
            : user(login, login, login);

    fragments.push({
      type: 'mention',
      text: match[0],
      mention: {
        user_id: mentioned.id,
        user_login: mentioned.login,
        user_name: mentioned.name,
      },
    });
    offset = match.index + match[0].length;
  }

  if (offset < text.length || !fragments.length)
    fragments.push({ type: 'text', text: text.slice(offset) });

  return { text, fragments };
}

export function replyFor(feed: Document[], messageId: string): Document | null {
  const item = feed.find((entry) => entry.data?.message_id === messageId);

  if (!item) return null;
  const parent = item.data;

  if (!parent.chatter_user_id && !parent.chatter_user_login) return null;

  const reply = parent.reply && typeof parent.reply === 'object' ? parent.reply : null;

  const threadMessageId = reply?.thread_message_id || reply?.parent_message_id || messageId;

  const threadUser = reply?.thread_message_id
    ? 'thread'
    : reply?.parent_message_id
      ? 'parent'
      : null;

  return {
    parent_message_id: messageId,
    parent_message_body: parent.message?.text ?? '',
    parent_user_id: parent.chatter_user_id ?? '',
    parent_user_name: parent.chatter_user_name ?? '',
    parent_user_login: parent.chatter_user_login ?? '',
    thread_message_id: threadMessageId,
    thread_user_id: threadUser
      ? (reply[`${threadUser}_user_id`] ?? '')
      : (parent.chatter_user_id ?? ''),
    thread_user_name: threadUser
      ? (reply[`${threadUser}_user_name`] ?? '')
      : (parent.chatter_user_name ?? ''),
    thread_user_login: threadUser
      ? (reply[`${threadUser}_user_login`] ?? '')
      : (parent.chatter_user_login ?? ''),
  };
}

export function chatMessage(
  input: Document,
  chatter: ReturnType<typeof chatUser>,
  text: string,
  reply: Document | null,
) {
  const badges = (input.badges ?? [])
    .filter((badge: Document) => typeof badge.set_id === 'string' && badge.set_id.trim())
    .map((badge: Document) => ({
      set_id: badge.set_id.trim(),
      id: (typeof badge.id === 'string' && badge.id.trim()) || '1',
      info: typeof badge.info === 'string' ? badge.info.trim() : '',
    }));

  const common = {
    ...broad,
    chatter_user_id: chatter.id,
    chatter_user_login: chatter.login,
    chatter_user_name: chatter.name,
    message_id: id(),
    message:
      input.parse_mentions === false
        ? { text, fragments: [{ type: 'text', text }] }
        : messagePayload(text),
    badges,
    color: input.color?.trim() || chatColor(chatter.login),
  };

  if (input.announce) {
    const color = String(input.announce_color ?? '')
      .trim()
      .toLowerCase();

    return {
      ...common,
      chatter_is_anonymous: false,
      system_message: `${chatter.name} highlighted their message`,
      notice_type: 'announcement',
      announcement: {
        color: ['blue', 'green', 'orange', 'purple'].includes(color) ? color : 'primary',
      },
    };
  }

  return {
    ...common,
    message_type: input.message_type?.trim() || 'text',
    cheer: input.bits > 0 ? { bits: input.bits } : null,
    reply,
    channel_points_custom_reward_id: input.channel_points_custom_reward_id?.trim() || null,
    channel_points_animation_id: null,
    source_broadcaster_user_id: null,
    source_broadcaster_user_login: null,
    source_broadcaster_user_name: null,
    source_message_id: null,
    source_badges: null,
    is_source_only: null,
  };
}
