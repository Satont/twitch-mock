import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Form, Notice, Panel, request, useNotice, type Json } from './shared';

const blank = {
  title: '',
  cost: 500,
  prompt: '',
  background_color: '#9146FF',
  is_user_input_required: false,
  is_enabled: true,
};

export function Rewards() {
  const [rewards, setRewards] = useState<Json[]>([]),
    [redemptions, setRedemptions] = useState<Json[]>([]),
    [meta, setMeta] = useState<Json>({}),
    [form, setForm] = useState<Json>(blank),
    [editing, setEditing] = useState(''),
    [rewardId, setRewardId] = useState(''),
    [user, setUser] = useState('99999'),
    [input, setInput] = useState('');

  const [loading, setLoading] = useState(true);
  const notice = useNotice();
  const { setNotice } = notice;

  const refresh = useCallback(async () => {
    const [r, d] = await Promise.all([
      request('/admin/rewards'),
      request('/admin/rewards/redemptions'),
    ]);

    setRewards(r.data ?? []);
    setRedemptions(d.data ?? []);
    setMeta(r);
    setRewardId((current) =>
      (r.data ?? []).some((item: Json) => item.id === current) ? current : (r.data?.[0]?.id ?? ''),
    );
  }, []);

  useEffect(() => {
    // Initial loading fetches remote state; updates happen after the request resolves.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh()
      .catch((error) => setNotice({ text: error.message, error: true }))
      .finally(() => setLoading(false));
  }, [refresh, setNotice]);

  async function action(path: string, body: Json, success: string) {
    return notice.run(async () => {
      await request(path, body);
      await refresh();
    }, success);
  }

  async function save() {
    const ok = await action(
      editing ? '/admin/rewards/update' : '/admin/rewards',
      { ...form, ...(editing ? { id: editing } : {}), cost: Number(form.cost) },
      editing ? 'Reward updated' : 'Reward created',
    );

    if (ok) {
      setForm(blank);
      setEditing('');
    }
  }

  function edit(reward: Json) {
    setEditing(reward.id);
    setForm({
      title: reward.title ?? '',
      cost: reward.cost ?? 500,
      prompt: reward.prompt ?? '',
      background_color: reward.background_color ?? '#9146FF',
      is_user_input_required: !!reward.is_user_input_required,
      is_enabled: !!reward.is_enabled,
    });
    document.getElementById('reward-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="stack">
      {meta.affiliate === false && (
        <output className="notice error">
          Channel Points require an affiliate or partner account. Change the broadcaster type in
          Settings.
        </output>
      )}
      <Notice value={notice.notice} />
      <div className="reward-grid">
        <Panel
          title={editing ? 'Edit reward' : 'Create reward'}
          description="Channel Points rewards are shared with Helix"
          className="reward-form-panel"
        >
          <Form className="form-stack" onSubmit={save}>
            <div id="reward-form" />
            <Field label="Title">
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Hydrate"
              />
            </Field>
            <div className="two-cols">
              <Field label="Cost">
                <input
                  required
                  type="number"
                  min="1"
                  max="2000000"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
                />
              </Field>
              <Field label="Color">
                <input
                  value={form.background_color}
                  onChange={(e) => setForm({ ...form, background_color: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Prompt">
              <input
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Optional prompt"
              />
            </Field>
            <div className="inline-checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.is_enabled}
                  onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
                />{' '}
                Enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.is_user_input_required}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      is_user_input_required: e.target.checked,
                    })
                  }
                />{' '}
                Require input
              </label>
            </div>
            <div className="row">
              <Button>{editing ? 'Save reward' : 'Create reward'}</Button>
              {editing && (
                <Button
                  type="button"
                  secondary
                  onClick={() => {
                    setEditing('');
                    setForm(blank);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </Form>
        </Panel>
        <div className="stack">
          <Panel
            title="Rewards"
            description="Create, update, and redeem rewards"
            action={<span className="count">{rewards.length} total</span>}
          >
            {loading ? (
              <div className="empty small">Loading rewards…</div>
            ) : rewards.length === 0 ? (
              <div className="empty small">No rewards yet. Create one to get started.</div>
            ) : (
              <div className="reward-list">
                {rewards.map((reward) => (
                  <div className="reward-row" key={reward.id}>
                    <span
                      className="reward-color"
                      style={{
                        background: reward.background_color || '#9146ff',
                      }}
                    />
                    <div className="reward-name">
                      <strong>{reward.title}</strong>
                      <small>
                        {reward.cost} points · {reward.is_enabled ? 'Enabled' : 'Disabled'}
                      </small>
                      <code>{reward.id}</code>
                    </div>
                    <div className="row compact">
                      <button className="text-button" onClick={() => edit(reward)}>
                        Edit
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          void action(
                            '/admin/rewards/update',
                            { id: reward.id, is_enabled: !reward.is_enabled },
                            reward.is_enabled ? 'Reward disabled' : 'Reward enabled',
                          )
                        }
                      >
                        {reward.is_enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="text-button destructive"
                        onClick={() => {
                          if (confirm(`Delete “${reward.title}”?`))
                            void action(
                              '/admin/rewards/delete',
                              { id: reward.id },
                              'Reward deleted',
                            );
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Simulate redemption" description="Redeem a reward as a mock viewer">
            <Form
              className="form-stack"
              onSubmit={() =>
                action(
                  '/admin/rewards/redeem',
                  { reward_id: rewardId, user_id: user, user_input: input },
                  'Reward redeemed',
                )
              }
            >
              <div className="two-cols">
                <Field label="Reward">
                  <select required value={rewardId} onChange={(e) => setRewardId(e.target.value)}>
                    <option value="" disabled>
                      Select a reward
                    </option>
                    {rewards.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({r.cost})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Viewer ID">
                  <input required value={user} onChange={(e) => setUser(e.target.value)} />
                </Field>
              </div>
              <Field label="Viewer input">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Optional message"
                />
              </Field>
              <div>
                <Button secondary disabled={!rewardId}>
                  Redeem reward
                </Button>
              </div>
            </Form>
          </Panel>
        </div>
      </div>
      <Panel
        title="Redemptions"
        description="Review and resolve redemption requests"
        action={<span className="count">{redemptions.length} total</span>}
      >
        {redemptions.length === 0 ? (
          <div className="empty small">No redemptions yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reward</th>
                  <th>Viewer</th>
                  <th>Input</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reward?.title ?? r.reward_id}</td>
                    <td>{r.user_name ?? r.user_id}</td>
                    <td>{r.user_input || '—'}</td>
                    <td>
                      <span className="count">{r.status}</span>
                    </td>
                    <td>
                      <div className="row compact">
                        {String(r.status).toUpperCase() === 'UNFULFILLED' && (
                          <>
                            <button
                              className="text-button"
                              onClick={() =>
                                void action(
                                  '/admin/rewards/redemption-status',
                                  {
                                    reward_id: r.reward_id,
                                    redemption_id: r.id,
                                    status: 'FULFILLED',
                                  },
                                  'Redemption fulfilled',
                                )
                              }
                            >
                              Fulfill
                            </button>
                            <button
                              className="text-button destructive"
                              onClick={() =>
                                void action(
                                  '/admin/rewards/redemption-status',
                                  {
                                    reward_id: r.reward_id,
                                    redemption_id: r.id,
                                    status: 'CANCELED',
                                  },
                                  'Redemption canceled',
                                )
                              }
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
