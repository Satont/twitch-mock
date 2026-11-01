import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Document = Record<string, any>;

export interface Snapshot {
  stream: Document;
  follows: { total: number; followed_user_ids: string[] };
  moderators: { moderator_ids: string[] };
  followedAt: Record<string, string>;
  account: { broadcaster_type: string };
  auth: {
    rejectRefresh: boolean;
    invalidAccessToken: boolean;
    missingScopes: string[];
  };
  documents: Record<string, Document[]>;
  feed: Document[];
  subscriptions: Document[];
  conduits: Document[];
  shield: boolean;
  description: string;
}

export function initialSnapshot(): Snapshot {
  return {
    stream: {
      online: false,
      title: 'Mock Stream',
      game_id: '',
      game_name: '',
      viewer_count: 0,
    },
    follows: { total: 0, followed_user_ids: ['67890'] },
    moderators: { moderator_ids: ['67890'] },
    followedAt: { '67890': new Date().toISOString() },
    account: { broadcaster_type: 'partner' },
    auth: {
      rejectRefresh: false,
      invalidAccessToken: false,
      missingScopes: [],
    },
    documents: {},
    feed: [],
    subscriptions: [],
    conduits: [],
    shield: false,
    description: '',
  };
}

export class Storage {
  readonly mode: 'memory' | 'sqlite';
  private db?: Database;
  data: Snapshot;

  constructor(
    mode = process.env.STORAGE ?? 'memory',
    path = process.env.SQLITE_PATH ?? './data/twitch-mock.sqlite',
  ) {
    if (mode !== 'memory' && mode !== 'sqlite') throw new Error(`Unknown STORAGE: ${mode}`);
    this.mode = mode;

    if (mode === 'sqlite') {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path, { create: true, strict: true });
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run(
        'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)',
      );

      const row = this.db.query('SELECT value FROM snapshot WHERE id = 1').get() as {
        value: string;
      } | null;

      this.data = row ? { ...initialSnapshot(), ...JSON.parse(row.value) } : initialSnapshot();

      // Live transports cannot survive a process restart.
      for (const conduit of this.data.conduits)
        for (const shard of conduit.shards ?? [])
          if (shard.transport) shard.transport.session_id = '';
      this.data.subscriptions = this.data.subscriptions.filter(
        (sub) => sub.transport?.method !== 'websocket',
      );
      this.save();
    } else this.data = initialSnapshot();
  }

  save() {
    if (!this.db) return;
    this.db
      .query(
        'INSERT INTO snapshot (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      )
      .run(JSON.stringify(this.data));
  }

  close() {
    this.db?.close();
  }
}
