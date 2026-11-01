import { Core, broad, buildEvent, now, user } from './core';
import type { Document } from './storage';

/** Emit the same EventSub side effects as the original Helix engine. */
export function helixHook(
  core: Core,
  slug: string,
  document: Document | undefined,
  body: Document,
  filters: Record<string, string>,
) {
  const emit = (type: string, payload: Document) =>
    core.broadcast('event', type, buildEvent(type, payload).event);

  const userId = filters.user_id || body.user_id || '';
  const doc = document ?? {};

  const poll = () => {
    const payload: Document = {
      id: doc.id ?? '',
      title: doc.title ?? '',
      choices: doc.choices,
      started_at: doc.started_at || now(),
    };

    const start = Date.parse(doc.started_at);

    if (Number.isFinite(start) && Number.isFinite(Number(doc.duration)))
      payload.ends_at = new Date(start + Number(doc.duration) * 1000).toISOString();

    return payload;
  };

  const prediction = () => ({
    id: doc.id ?? '',
    title: doc.title ?? '',
    outcomes: doc.outcomes,
    started_at: doc.started_at || now(),
    ...(typeof doc.locks_at === 'string' ? { locks_at: doc.locks_at } : {}),
  });

  switch (slug) {
    case 'create-poll':
      emit('channel.poll.begin', poll());
      break;
    case 'end-poll':
      emit('channel.poll.end', { ...poll(), status: body.status || 'completed', ended_at: now() });
      break;
    case 'create-prediction':
      emit('channel.prediction.begin', prediction());
      break;
    case 'end-prediction':
      emit('channel.prediction.end', {
        ...prediction(),
        status: body.status || 'resolved',
        ended_at: now(),
        ...(body.winning_outcome_id ? { winning_outcome_id: body.winning_outcome_id } : {}),
      });
      break;
    case 'start-a-raid': {
      const target = user(body.to_broadcaster_id || '');
      emit('channel.raid', {
        from_broadcaster_user_id: broad.broadcaster_user_id,
        from_broadcaster_user_login: broad.broadcaster_user_login,
        from_broadcaster_user_name: broad.broadcaster_user_name,
        to_broadcaster_user_id: target.id,
        to_broadcaster_user_login: target.login,
        to_broadcaster_user_name: target.name,
        viewers: body.viewers,
      });
      break;
    }

    case 'start-commercial':
      emit('channel.ad_break.begin', {
        duration_seconds: body.length,
        started_at: now(),
        is_automatic: false,
        requester_user_id: '67890',
      });
      break;
    case 'send-a-shoutout': {
      const target = user(filters.to_broadcaster_id || body.to_broadcaster_id || '');
      emit('channel.shoutout.create', {
        to_broadcaster_user_id: target.id,
        to_broadcaster_user_login: target.login,
        to_broadcaster_user_name: target.name,
        viewer_count: 0,
      });
      break;
    }

    case 'warn-chat-user':
      emit('channel.warning.send', { user_id: userId || '12345', reason: body.reason || '' });
      break;
    case 'add-suspicious-status-to-chat-user':
      emit('channel.suspicious_user.update', {
        user_id: userId || '12345',
        low_trust_status: 'active_monitoring',
      });
      break;
    case 'remove-suspicious-status-from-chat-user':
      emit('channel.suspicious_user.update', {
        user_id: userId || '12345',
        low_trust_status: 'none',
      });
      break;
    case 'create-guest-star-session':
      emit('channel.guest_star_session.begin', {});
      break;
    case 'end-guest-star-session':
      emit('channel.guest_star_session.end', {});
      break;
    case 'update-channel-guest-star-settings':
      emit('channel.guest_star_settings.update', {});
      break;
    case 'assign-guest-star-slot':
    case 'update-guest-star-slot':
    case 'delete-guest-star-slot':
      emit('channel.guest_star_guest.update', {});
      break;
    case 'update-automod-settings':
      emit('automod.settings.update', doc);
      break;
    case 'manage-held-automod-messages':
      emit('automod.message.update', {
        message_id: body.msg_id || '',
        status: body.action || 'approved',
      });
      break;
  }
}
