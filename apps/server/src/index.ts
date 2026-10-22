import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createMeetMeServer } from './app';
import { openPostgres } from './postgres';
import { FcmSender } from './push';

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const dbPath = process.env.DB_PATH ?? './data/meetme.db';
const attachmentsDir = process.env.ATTACHMENTS_DIR ?? join(dirname(dbPath), 'attachments');
mkdirSync(dirname(dbPath), { recursive: true });

const adminUsers = list(process.env.ADMIN_USERS).map((u) => u.toLowerCase());

// PostgreSQL when DATABASE_URL is set (production), otherwise a local SQLite file.
const pg = process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : undefined;
// Wake-up pushes (Android + iOS through Firebase Cloud Messaging) when a service account is configured.
const push = FcmSender.fromEnv();

const server = createMeetMeServer(
  {
    dbPath,
    attachmentsDir,
    stunUrls: list(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302'),
    turnUrls: list(process.env.TURN_URLS),
    turnSecret: process.env.TURN_SECRET,
    trustProxy: process.env.TRUST_PROXY === '1',
    adminUsers,
    // With an admin configured, only admins create accounts (unless OPEN_REGISTRATION=1).
    openRegistration: process.env.OPEN_REGISTRATION === '1' || adminUsers.length === 0,
  },
  { ...pg, push },
);

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
  console.log(`CellMate server listening on http://${host}:${port} (database: ${pg ? 'PostgreSQL' : 'SQLite'}, push: ${push ? 'on' : 'off'})`);
  console.log(
    process.env.ADMIN_USERS
      ? `Admins: ${process.env.ADMIN_USERS}`
      : 'No admin set. Start with ADMIN_USERS=<username> to enable broadcasts.',
  );
  if (!process.env.TURN_URLS) {
    console.log('No TURN server configured: calls use STUN only (peers can see each other\'s IP).');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
