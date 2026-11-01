import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Icon, Notice, Panel, request, useNotice, type Json } from './shared';

const quickEvents = [
  'stream.online',
  'stream.offline',
  'channel.follow',
  'channel.subscribe',
  'channel.raid',
  'channel.update',
];

function displayDescription(description: string) {
  const text = description.trim();

  return /^[^.?!]*\.$/.test(text) ? text.slice(0, -1) : description;
}

export function Events() {
  const [catalog, setCatalog] = useState<Json[]>([]),
    [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [payload, setPayload] = useState('{}'),
    [loading, setLoading] = useState(true);

  const [result, setResult] = useState<Json | null>(null);
  const notice = useNotice();
  const { setNotice } = notice;
  useEffect(() => {
    request('/admin/catalog/events')
      .then((data) => {
        setCatalog(data.data ?? []);

        if (data.data?.length) {
          setSelected(`${data.data[0].type}:${data.data[0].version}`);
          setPayload(JSON.stringify(data.data[0].payload, null, 2));
        }
      })
      .catch((error) => setNotice({ text: error.message, error: true }))
      .finally(() => setLoading(false));
  }, [setNotice]);

  const filtered = useMemo(
    () =>
      catalog.filter((item) =>
        `${item.type} ${item.name} ${item.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [catalog, search],
  );

  const entry = catalog.find((item) => `${item.type}:${item.version}` === selected);

  function select(item: Json) {
    setSelected(`${item.type}:${item.version}`);
    setPayload(JSON.stringify(item.payload, null, 2));
    setResult(null);
  }

  async function trigger() {
    await notice.run(async () => {
      const body = JSON.parse(payload);

      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('The event payload must be a JSON object');
      setResult(
        await request(
          `/admin/trigger/${encodeURIComponent(entry?.type ?? '')}?version=${encodeURIComponent(entry?.version ?? '')}`,
          body,
        ),
      );
    }, 'Event sent to connected subscribers');
  }

  return (
    <div className="events-layout">
      <Panel
        title="Event catalog"
        description="Find a subscription type to simulate"
        action={<span className="count">{catalog.length} events</span>}
      >
        <Field label="Search events">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or type"
          />
        </Field>
        <fieldset className="event-list">
          <legend className="sr-only">Event types</legend>
          {loading ? (
            <p className="empty small">Loading events…</p>
          ) : filtered.length === 0 ? (
            <p className="empty small">No events match your search</p>
          ) : (
            filtered.map((item) => (
              <label
                className={`event-option ${`${item.type}:${item.version}` === selected ? 'selected' : ''}`}
                key={`${item.type}:${item.version}`}
                title={`${item.name || item.type} · ${item.type} · version ${item.version}`}
              >
                <input
                  type="radio"
                  aria-label={`${item.name || item.type}, ${item.type}, version ${item.version}`}
                  name="event-type"
                  value={`${item.type}:${item.version}`}
                  checked={`${item.type}:${item.version}` === selected}
                  onChange={() => select(item)}
                />
                <span className="event-name">
                  <span className="event-title">{item.name || item.type}</span>
                  <small>{item.type}</small>
                </span>
                <span className="version">v{item.version}</span>
              </label>
            ))
          )}
        </fieldset>
      </Panel>
      <div className="stack">
        <Panel title="Quick triggers" description="Send common events with their default payload">
          <div className="quick-list">
            {quickEvents.map((name) => (
              <button
                key={name}
                onClick={() => {
                  const item = catalog.find((e) => e.type === name);

                  if (item) {
                    select(item);
                    void notice.run(
                      async () => {
                        setResult(
                          await request(
                            `/admin/trigger/${encodeURIComponent(item.type)}?version=${encodeURIComponent(item.version)}`,
                            item.payload,
                          ),
                        );
                      },
                      `${item.name || item.type} sent`,
                    );
                  }
                }}
                disabled={!catalog.some((e) => e.type === name)}
              >
                {name}
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </Panel>
        <Panel
          title={entry?.name || 'Event payload'}
          description={
            entry ? `${entry.type} · version ${entry.version}` : 'Choose an event from the catalog'
          }
        >
          {entry && (
            <div className="form-stack">
              <p className="hint">{displayDescription(entry.description || '')}</p>
              <Field label="JSON payload" hint="Edit the payload before sending the event">
                <textarea
                  className="code-editor"
                  spellCheck={false}
                  rows={16}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                />
              </Field>
              <div className="row">
                <Button onClick={() => void trigger()}>Trigger event</Button>
                <Button
                  secondary
                  onClick={() => setPayload(JSON.stringify(entry.payload, null, 2))}
                >
                  Reset payload
                </Button>
              </div>
              {result && (
                <details className="result-details">
                  <summary>View response</summary>
                  <pre>{JSON.stringify(result, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
          <Notice value={notice.notice} />
        </Panel>
      </div>
    </div>
  );
}
