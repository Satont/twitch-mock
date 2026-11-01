import { useEffect, useState } from 'react';
import { Button, Field, Form, Notice, Panel, request, useNotice, type Json } from './shared';

const lines = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

export function Controls({
  tab,
  onStream,
}: {
  tab: 'overview' | 'settings';
  onStream: (online: boolean) => void;
}) {
  const [stream, setStream] = useState<Json | null>(null);
  const [follows, setFollows] = useState<Json | null>(null);
  const [moderators, setModerators] = useState('');
  const [account, setAccount] = useState('partner');
  const [auth, setAuth] = useState<Json | null>(null);
  const [loadError, setLoadError] = useState('');

  const streamNotice = useNotice(),
    followNotice = useNotice(),
    modNotice = useNotice(),
    accountNotice = useNotice(),
    authNotice = useNotice();

  useEffect(() => {
    let active = true;
    Promise.all([
      request('/admin/state/stream'),
      request('/admin/state/follows'),
      request('/admin/state/moderators'),
      request('/admin/state/account'),
      request('/admin/state/auth'),
    ])
      .then(([s, f, m, a, authState]) => {
        if (!active) return;
        setStream(s);
        setFollows({
          ...f,
          followed_user_ids: (f.followed_user_ids ?? []).join('\n'),
        });
        setModerators((m.moderator_ids ?? []).join('\n'));
        setAccount(a.broadcaster_type ?? '');
        setAuth({
          ...authState,
          missingScopes: (authState.missingScopes ?? []).join(' '),
        });
        onStream(Boolean(s.online));
      })
      .catch((error) => {
        if (active) setLoadError(error.message);
      });

    return () => {
      active = false;
    };
  }, [onStream]);

  if (loadError)
    return (
      <div className="empty error" role="alert">
        Could not load mock state: {loadError}{' '}
        <button className="text-button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );

  if (!stream || !follows || !auth) return <div className="empty">Loading mock state…</div>;

  if (tab === 'settings')
    return (
      <div className="content-grid settings-grid">
        <Panel
          title="Broadcaster account"
          description="Control access to Channel Points and affiliate features"
        >
          <Form
            className="form-stack"
            onSubmit={() =>
              accountNotice.run(async () => {
                const result = await request('/admin/state/account', {
                  broadcaster_type: account,
                });

                setAccount(result.broadcaster_type ?? '');
              }, 'Account type saved')
            }
          >
            <Field label="Account type">
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">None</option>
                <option value="affiliate">Affiliate</option>
                <option value="partner">Partner</option>
              </select>
            </Field>
            <p className="hint">Channel Points require affiliate or partner status</p>
            <div>
              <Button>Save account</Button>
            </div>
            <Notice value={accountNotice.notice} />
          </Form>
        </Panel>
        <Panel
          title="Authorization failures"
          description="Simulate broken OAuth credentials and missing permissions"
        >
          <Form
            className="form-stack"
            onSubmit={() =>
              authNotice.run(async () => {
                const result = await request('/admin/state/auth', {
                  ...auth,
                  missingScopes: lines(auth.missingScopes),
                });

                setAuth({
                  ...result,
                  missingScopes: (result.missingScopes ?? []).join(' '),
                });
              }, 'Authorization settings saved')
            }
          >
            <label className="check-row" aria-label="Reject refresh token">
              <input
                type="checkbox"
                checked={!!auth.rejectRefresh}
                onChange={(e) => setAuth({ ...auth, rejectRefresh: e.target.checked })}
              />
              <span>
                <strong>Reject refresh token</strong>
                <small>Simulate a revoked refresh token</small>
              </span>
            </label>
            <label className="check-row" aria-label="Invalidate access token">
              <input
                type="checkbox"
                checked={!!auth.invalidAccessToken}
                onChange={(e) => setAuth({ ...auth, invalidAccessToken: e.target.checked })}
              />
              <span>
                <strong>Invalidate access token</strong>
                <small>Helix responds with an OAuth error</small>
              </span>
            </label>
            <Field label="Missing scopes" hint="Separate scopes with spaces or commas">
              <input
                value={auth.missingScopes}
                onChange={(e) => setAuth({ ...auth, missingScopes: e.target.value })}
                placeholder="moderator:read:chatters"
              />
            </Field>
            <div>
              <Button>Save authorization</Button>
            </div>
            <Notice value={authNotice.notice} />
          </Form>
        </Panel>
      </div>
    );

  return (
    <div className="overview-layout">
      <Panel
        title="Stream configuration"
        description="Set the channel state returned to your application"
        action={
          <span className={`status-pill ${stream.online ? 'live' : ''}`}>
            <i />
            {stream.online ? 'Live' : 'Offline'}
          </span>
        }
      >
        <Form
          className="form-stack"
          onSubmit={() =>
            streamNotice.run(async () => {
              const result = await request('/admin/state/stream', {
                ...stream,
                viewer_count: Number(stream.viewer_count),
              });

              setStream(result);
              onStream(Boolean(result.online));
            }, 'Stream state saved')
          }
        >
          <label className="switch-row" aria-label="Stream is online">
            <span>
              <strong>Stream is online</strong>
              <small>Change the mock stream status</small>
            </span>
            <input
              type="checkbox"
              checked={!!stream.online}
              onChange={(e) => setStream({ ...stream, online: e.target.checked })}
            />
          </label>
          <Field label="Stream title">
            <input
              value={stream.title ?? ''}
              onChange={(e) => setStream({ ...stream, title: e.target.value })}
            />
          </Field>
          <div className="two-cols">
            <Field label="Category name">
              <input
                value={stream.game_name ?? ''}
                onChange={(e) => setStream({ ...stream, game_name: e.target.value })}
                placeholder="e.g. Just Chatting"
              />
            </Field>
            <Field label="Category ID">
              <input
                value={stream.game_id ?? ''}
                onChange={(e) => setStream({ ...stream, game_id: e.target.value })}
                placeholder="e.g. 509658"
              />
            </Field>
          </div>
          <Field label="Viewer count">
            <input
              type="number"
              min="0"
              value={stream.viewer_count ?? 0}
              onChange={(e) => setStream({ ...stream, viewer_count: Number(e.target.value) })}
            />
          </Field>
          <div>
            <Button>Save stream</Button>
          </div>
          <Notice value={streamNotice.notice} />
        </Form>
      </Panel>
      <div className="stack">
        <Panel title="Followers" description="Set the total and followed user IDs">
          <Form
            className="form-stack"
            onSubmit={() =>
              followNotice.run(async () => {
                const result = await request('/admin/state/follows', {
                  total: Number(follows.total),
                  followed_user_ids: lines(follows.followed_user_ids),
                });

                setFollows({
                  ...result,
                  followed_user_ids: (result.followed_user_ids ?? []).join('\n'),
                });
              }, 'Followers saved')
            }
          >
            <Field label="Total followers">
              <input
                type="number"
                min="0"
                value={follows.total ?? 0}
                onChange={(e) => setFollows({ ...follows, total: Number(e.target.value) })}
              />
            </Field>
            <Field label="Followed user IDs" hint="One ID per line">
              <textarea
                rows={3}
                value={follows.followed_user_ids}
                onChange={(e) => setFollows({ ...follows, followed_user_ids: e.target.value })}
              />
            </Field>
            <div>
              <Button secondary>Save followers</Button>
            </div>
            <Notice value={followNotice.notice} />
          </Form>
        </Panel>
        <Panel title="Moderators" description="Manage which users have moderator access">
          <Form
            className="form-stack"
            onSubmit={() =>
              modNotice.run(async () => {
                const result = await request('/admin/state/moderators', {
                  moderator_ids: lines(moderators),
                });

                setModerators((result.moderator_ids ?? []).join('\n'));
              }, 'Moderators saved')
            }
          >
            <Field label="Moderator user IDs" hint="One ID per line">
              <textarea
                rows={3}
                value={moderators}
                onChange={(e) => setModerators(e.target.value)}
              />
            </Field>
            <div>
              <Button secondary>Save moderators</Button>
            </div>
            <Notice value={modNotice.notice} />
          </Form>
        </Panel>
      </div>
    </div>
  );
}
