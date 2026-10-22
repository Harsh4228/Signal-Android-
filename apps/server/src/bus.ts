/**
 * Events other server instances must hear about. With one server (SQLite) nothing needs to travel,
 * so LocalBus does nothing; with PostgreSQL, PgBus sends them over LISTEN / NOTIFY.
 */
export type BusEvent =
  /** A new envelope was queued; whoever holds the recipient's socket delivers it. */
  | { type: 'envelope'; to: string; id: number }
  /** Close this user's socket and forget cached credentials (new login, removed, deleted). */
  | { type: 'kick'; user: string; code: number; reason: string }
  /** The user connected to another instance; close any older socket here. */
  | { type: 'connected'; user: string }
  /** Tell these users (null = everyone) to reload their groups / the org policy. */
  | { type: 'refresh'; users: string[] | null; what: 'groups' | 'policy' };

export interface Bus {
  publish(e: BusEvent): Promise<void>;
  onEvent(fn: (e: BusEvent) => void): void;
  close(): Promise<void>;
}

export class LocalBus implements Bus {
  async publish() {}
  onEvent() {}
  async close() {}
}
