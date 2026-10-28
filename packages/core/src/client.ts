import { bytesToHex } from '@noble/hashes/utils';
import {
  DEFAULT_POLICY,
  GROUP_ID_RE,
  AVATAR_MIMES,
  MAX_ATTACHMENT_BYTES,
  MAX_AVATAR_BYTES,
  type AvatarResponse,
  MAX_EVENT_DESC,
  MAX_EVENT_PLACE,
  MAX_EVENT_TITLE,
  MAX_NOTICE_TITLE,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_PLACE_NAME,
  MAX_PRODUCT_DESC,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
  MAX_QUOTE,
  MAX_STATUS_TEXT,
  REACTIONS,
  MAX_TEXT_LENGTH,
  STATUS_COLORS,
  STATUS_TTL_MS,
  USERNAME_RE,
  ID_RE,
  COMPANY_CODE_RE,
  MIN_PASSWORD_LENGTH,
  makeUsername,
  shortId,
  type RegisterRequest,
  type AdminStats,
  type AdminUser,
  type AttachmentPointer,
  type AuditEntry,
  type ClientFrame,
  DEFAULT_RIGHTS,
  type Feature,
  type HelpContact,
  type HelpContactInput,
  type ChannelInfo,
  type Community,
  type MyRights,
  type Page,
  type RightChange,
  type RightRule,
  type Rights,
  type GroupInfo,
  type LoginRequest,
  type MeResponse,
  type Policy,
  type Presence,
  type PublicConfig,
  type IceConfigResponse,
  type KeyBundleResponse,
  type Payload,
  type PushKind,
  type Product,
  type ProductCard,
  type ProductInput,
  type PushTokenRequest,
  type Quote,
  type Rsvp,
  type SharedLocation,
  type ServerFrame,
  type UploadKeysRequest,
  type UserProfile,
  type EmployeeInput,
  type InviteResponse,
  type JoinRequest,
  type HistoryBackup,
  type PrivacyRequest,
} from './api';
import { attachmentKind, decryptAttachment, encryptAttachment, safeFileName, type AttachmentKind } from './attachments';
import { randomBytes } from './crypto/primitives';
import { DuplicateMessageError } from './crypto/ratchet';
import type { PreKeyBundle } from './crypto/x3dh';
import { Emitter } from './emitter';
import { fromBase64, fromUtf8, toBase64, utf8 } from './encoding';
import { safetyNumber } from './fingerprint';
import {
  deliveryKeyHash,
  isSealed,
  newDeliveryKey,
  sealMessage,
  unsealMessage,
  verifyCertificate,
  type SenderCertificate,
} from './sealed';
import {
  createAccount,
  generateOneTimePreKeys,
  makeSignedPreKey,
  maybeRotateSignedPreKey,
  publicSpk,
  ONE_TIME_PREKEY_BATCH,
  ONE_TIME_PREKEY_LOW_WATER,
} from './keys';
import { MediaStore, MemoryBlobStorage, type BlobStorage, type MediaItem } from './media';
import {
  makeSnapshot,
  mergeSnapshot,
  lockBackupKey,
  newBackupKeys,
  openBackup,
  parseSnapshot,
  sealBackup,
  unlockBackupKey,
  type BackupKeys,
  type HistorySnapshot,
} from './history';
import { SessionCipher, type WireMessage } from './session';
import { ProtocolStore, type Account, type SecureStorage } from './store';

export type ConnectionStatus = 'offline' | 'connecting' | 'online';
export type CallSignal = Extract<Payload, { k: 'call' }>;
export type GroupCallSignal = Extract<Payload, { k: 'gcall' }>;

export interface ChatMessage {
  id: string;
  /** Chat key: a username, or "#<groupId>" for a group chat. */
  peer: string;
  /** Who wrote it (group chats only; in 1:1 chats it is `peer`). */
  from?: string;
  text: string;
  ts: number;
  outgoing: boolean;
  system?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  expiresAt?: number;
  receiptSent?: 'delivered' | 'read';
  /** Company-wide announcement from an admin. */
  broadcast?: boolean;
  attachment?: Attachment;
  edited?: boolean;
  /** Deleted for everyone: content wiped, a placeholder stays. */
  deleted?: boolean;
  /** A call with this contact (like WhatsApp's call entries). Written locally by each side, never sent. */
  call?: CallLog;
  poll?: Poll;
  event?: ChatEvent;
  /** This message answers another one (quoted above it). */
  replyTo?: Quote;
  /** Who reacted with what (one emoji per person). */
  reactions?: Record<string, string>;
  /** Contact card: a colleague's username. */
  contact?: string;
  location?: SharedLocation;
  product?: ProductCard;
  forwarded?: boolean;
  /** Kept in my Starred messages. */
  starred?: boolean;
  /** @mentions (usernames) in a group message. */
  mentions?: string[];
  /** View once: the file can be opened one time; `opened` = it was (then it is gone). */
  viewOnce?: boolean;
  opened?: boolean;
  /** My message: when it reached them / they read it (message info). */
  deliveredAt?: number;
  readAt?: number;
}

/** Per-chat choices kept on this device (and in the backup): pinned, archived, muted. */
export interface ChatPrefs {
  /** When it was pinned (ms); pinned chats are on top, the last pinned first. */
  pinned?: number;
  archived?: boolean;
  /** Muted until (ms); Number.MAX_SAFE_INTEGER = always. */
  muteUntil?: number;
}
export const MAX_PINNED = 3;

/** Finds "@id" / "@Name" mentions of these members in a text (usernames, once each). */
export function findMentions(text: string, members: string[], nameOf: (u: string) => string): string[] {
  const lower = text.toLowerCase();
  return members.filter((u) => {
    const id = shortId(u).toLowerCase();
    const name = nameOf(u).toLowerCase();
    return lower.includes(`@${id}`) || (!!name && lower.includes(`@${name}`));
  });
}

/** Links in a message (http / https), to show them tappable. */
export const LINK_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** A starred message, kept (encrypted) on this device so the list survives restarts. Text only, no files. */
export interface StarredMessage {
  chat: string;
  msgId: string;
  from: string;
  outgoing: boolean;
  ts: number;
  /** Short description, e.g. the text, "Photo: caption" or "📍 Office". */
  preview: string;
}

/** Google Maps link for a shared location (opened only when the user taps it). */
export function mapsUrl(l: SharedLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${l.lat.toFixed(6)},${l.lng.toFixed(6)}`;
}

function cleanQuote(q: unknown): Quote | undefined {
  const r = q as Quote | undefined;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length > 64) return undefined;
  if (typeof r.from !== 'string' || !USERNAME_RE.test(r.from) || typeof r.text !== 'string') return undefined;
  return { id: r.id, from: r.from, text: r.text.slice(0, MAX_QUOTE) };
}

function cleanLocation(l: unknown): SharedLocation | undefined {
  const r = l as SharedLocation | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const ok = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
  if (!ok(r.lat, 90) || !ok(r.lng, 180)) return undefined;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_PLACE_NAME) : '';
  return { lat: r.lat, lng: r.lng, name: name || undefined };
}

function cleanProduct(p: unknown): ProductCard | undefined {
  const r = p as ProductCard | undefined;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[0-9a-f]{16,32}$/.test(r.id)) return undefined;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const name = str(r.name, MAX_PRODUCT_NAME);
  if (!name) return undefined;
  const owner = typeof r.owner === 'string' && USERNAME_RE.test(r.owner) ? r.owner : undefined;
  return { id: r.id, owner, name, price: str(r.price, MAX_PRODUCT_PRICE), description: str(r.description, MAX_PRODUCT_DESC) };
}

export interface Poll {
  question: string;
  options: string[];
  /** People may pick more than one option. */
  multi: boolean;
  /** Who picked what (option indexes), me included. */
  votes: Record<string, number[]>;
}

export interface ChatEvent {
  title: string;
  description?: string;
  /** ms since 1970 */
  start: number;
  end?: number;
  place?: string;
  /** Who answered what, me included. */
  rsvp: Record<string, Rsvp>;
}

export interface NewEvent {
  title: string;
  description?: string;
  start: number;
  end?: number;
  place?: string;
}

/** How many people picked each option. */
export function pollCounts(p: Poll): number[] {
  const counts = p.options.map(() => 0);
  for (const picks of Object.values(p.votes)) for (const i of picks) counts[i]!++;
  return counts;
}

/** Checks a poll from the wire (or one I'm about to send). null = not a valid poll. */
function cleanPoll(q: unknown, opts: unknown, multi: unknown): Poll | null {
  if (typeof q !== 'string' || !Array.isArray(opts)) return null;
  const question = q.trim();
  const options = opts.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (!question || question.length > MAX_POLL_QUESTION) return null;
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS) return null;
  if (options.some((o) => !o || o.length > MAX_POLL_OPTION)) return null;
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return null;
  return { question, options, multi: multi === true, votes: {} };
}

/** Checks an event from the wire (or one I'm about to send). null = not a valid event. */
function cleanEvent(e: { title?: unknown; desc?: unknown; start?: unknown; end?: unknown; place?: unknown }): ChatEvent | null {
  const str = (v: unknown, max: number) => (v === undefined ? '' : typeof v === 'string' && v.trim().length <= max ? v.trim() : null);
  const title = str(e.title, MAX_EVENT_TITLE);
  const description = str(e.desc, MAX_EVENT_DESC);
  const place = str(e.place, MAX_EVENT_PLACE);
  if (!title || description === null || place === null) return null;
  const okTime = (t: unknown) => typeof t === 'number' && Number.isFinite(t) && t > 0 && t < 8.64e15;
  if (!okTime(e.start) || (e.end !== undefined && (!okTime(e.end) || (e.end as number) < (e.start as number)))) return null;
  return {
    title,
    description: description || undefined,
    start: e.start as number,
    end: e.end as number | undefined,
    place: place || undefined,
    rsvp: {},
  };
}

/** Valid option indexes for this poll (no repeats; one at most unless it allows several). */
function validVote(p: Poll, ch: unknown): ch is number[] {
  if (!Array.isArray(ch) || ch.length > p.options.length || (!p.multi && ch.length > 1)) return false;
  return ch.every((i) => Number.isInteger(i) && i >= 0 && i < p.options.length) && new Set(ch).size === ch.length;
}

export interface CallLog {
  video: boolean;
  /** true = I called them. */
  outgoing: boolean;
  /**
   * answered: we talked (see durationSec) · missed: they called, I didn't answer · declined: rejected
   * (by me if incoming, by them if outgoing) · cancelled: I hung up before they answered ·
   * no-answer / busy: they didn't pick up / were in another call · failed: couldn't connect
   */
  outcome: 'answered' | 'missed' | 'declined' | 'cancelled' | 'no-answer' | 'busy' | 'failed';
  durationSec?: number;
}

/** "1:05", "12:40", "1:02:03" */
export function formatCallDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Call entry headline: "Video call", "Voice call", or "Missed video call". */
export function callTitle(c: CallLog): string {
  const kind = c.video ? 'video call' : 'voice call';
  return c.outcome === 'missed' ? `Missed ${kind}` : kind[0]!.toUpperCase() + kind.slice(1);
}

/** Call entry detail under the headline: "Outgoing · 2:15", "No answer", "Declined", ... ('' for missed). */
export function callDetail(c: CallLog): string {
  const dir = c.outgoing ? 'Outgoing' : 'Incoming';
  switch (c.outcome) {
    case 'answered':
      return c.durationSec !== undefined ? `${dir} · ${formatCallDuration(c.durationSec)}` : dir;
    case 'missed':
      return '';
    case 'declined':
      return c.outgoing ? 'Declined by them' : 'You declined';
    case 'cancelled':
      return 'Cancelled';
    case 'no-answer':
      return 'No answer';
    case 'busy':
      return 'Busy';
    case 'failed':
      return 'Not connected';
  }
}

/** Shown in red: a call I didn't take, or one the other side didn't take. */
export const callMissed = (c: CallLog) => c.outcome !== 'answered' && c.outcome !== 'cancelled';

/** The line shown in the chat and the chat list, e.g. "Missed video call", "Outgoing voice call · 2:15". */
export function callLogText(c: CallLog): string {
  const kind = c.video ? 'video call' : 'voice call';
  if (c.outcome === 'missed') return `Missed ${kind}`;
  if (c.outcome === 'declined' && !c.outgoing) return `Declined ${kind}`;
  const head = `${c.outgoing ? 'Outgoing' : 'Incoming'} ${kind}`;
  const tail: Record<CallLog['outcome'], string> = {
    answered: c.durationSec !== undefined ? formatCallDuration(c.durationSec) : '',
    missed: '',
    declined: 'declined',
    cancelled: 'cancelled',
    'no-answer': 'no answer',
    busy: 'busy',
    failed: 'not connected',
  };
  return tail[c.outcome] ? `${head} · ${tail[c.outcome]}` : head;
}

/** Group chats live under "#<groupId>" keys; usernames can never contain "#". */
export const groupKey = (id: string) => `#${id}`;
export const isGroupKey = (key: string) => key.startsWith('#');
export const groupIdOf = (key: string) => key.slice(1);

const TYPING_SHOW_MS = 6000;
const TYPING_SEND_EVERY_MS = 4000;
const MAX_TYPING_FANOUT = 50;

/** A file in a chat. `data` lives only in memory - it is never written to disk. */
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  state: 'uploading' | 'downloading' | 'ready' | 'failed';
  data?: Uint8Array;
  /**
   * Where the encrypted file is on the server, with its key (kept in the encrypted history, so a restored chat on
   * another device can still fetch the file while the server keeps it: 14 days).
   */
  ptr?: AttachmentPointer;
}

export interface OutgoingFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface BroadcastResult {
  sent: number;
  failed: string[];
}

/**
 * A notice from an admin. Employees see it pop up until they click OK; both sides keep it in their notice
 * list. Unlike chat messages, notices are kept in the device's encrypted store so the list survives restarts.
 */
export interface Notice {
  id: string;
  /** The admin who sent it (me, for notices I sent). */
  from: string;
  title: string;
  text: string;
  ts: number;
  outgoing: boolean;
  /** Received: when I clicked OK. Unset = it still pops up. */
  okAt?: number;
  /** Received: my OK reached the admin (otherwise it is sent again when the app reconnects). */
  okSent?: boolean;
  /** Sent: who it was for, e.g. "Everyone" or "Sales, Night shift". */
  audience?: string;
  /** Sent: everyone it was delivered to. */
  recipients?: string[];
  /** Sent: who clicked OK, and when. */
  okBy?: Record<string, number>;
}

/** Who gets a notice: people in any of these departments or groups. Both empty = everyone. */
export interface NoticeTarget {
  departments?: string[];
  /** Group ids. */
  groups?: string[];
}

const MAX_NOTICES = 500;

/**
 * A status update (like WhatsApp). Kept in the encrypted store until 24 hours after it was posted, so it
 * survives restarts; a photo stays encrypted on the server and is downloaded into memory when viewed.
 */
export interface StatusUpdate {
  id: string;
  /** Who posted it (me, for my own). */
  from: string;
  ts: number;
  /** Text status, or the caption of a photo. */
  text: string;
  /** Text status background (one of STATUS_COLORS). */
  bg?: string;
  photo?: AttachmentPointer;
  outgoing: boolean;
  /** Received: I have viewed it. */
  seen?: boolean;
  /** Mine: everyone it was delivered to. */
  audience?: string[];
  /** Mine: who viewed it, and when. */
  viewers?: Record<string, number>;
}

/** One person's current statuses, oldest first (the order they are played in). */
export interface StatusGroup {
  user: string;
  items: StatusUpdate[];
  /** Every one of them viewed. */
  allSeen: boolean;
  /** Newest post. */
  latest: number;
}

export type NewStatus = { text: string; bg?: string } | { photo: OutgoingFile; caption?: string };

/**
 * Usernames a notice goes to: people who have logged in at least once, aren't banned and aren't me, and are
 * in one of the chosen departments or groups (everyone when none are chosen). Each person is listed once.
 */
export function noticeAudience(users: AdminUser[], groups: GroupInfo[], target: NoticeTarget, me?: string): string[] {
  const depts = new Set(target.departments ?? []);
  const members = new Set(groups.filter((g) => target.groups?.includes(g.id)).flatMap((g) => g.members));
  const everyone = !depts.size && !target.groups?.length;
  return users
    .filter((u) => u.active && !u.banned && u.username !== me)
    .filter((u) => everyone || members.has(u.username) || u.departments.some((d) => depts.has(d)))
    .map((u) => u.username);
}

type Events = {
  change: [];
  message: [ChatMessage];
  /** A new notice arrived (it is also in pendingNotices() until OK is clicked). */
  notice: [Notice];
  callSignal: [string, CallSignal];
  groupCallSignal: [string, GroupCallSignal];
  identityChanged: [string];
  error: [string];
};

export interface ClientOptions {
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  /** Where saved chat media goes (encrypted). Default: memory only. */
  blobs?: BlobStorage;
}

export class MustChangePasswordError extends Error {
  constructor() {
    super('Please choose your own new password');
  }
}

/**
 * Tidy a typed server address: trims it, drops trailing slashes and adds a scheme when it's missing
 * (http:// for localhost and private-network addresses, https:// for everything else).
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
    url = (local ? 'http://' : 'https://') + url;
  }
  return url;
}

/** fetch() only throws when the server can't be reached at all (wrong address, down, http vs https). */
function unreachable(serverUrl: string, e: unknown): unknown {
  if (!(e instanceof TypeError)) return e;
  const hint = /^https:\/\/(localhost|127\.)/i.test(serverUrl) ? ' A local server uses http://, not https://.' : '';
  return new Error(`Can't reach the server at ${serverUrl}. Check the address and that the server is running.${hint}`);
}

/**
 * What a QR invite contains: "cellmate://join?s=<server>&u=<id>&t=<secret>". The same text works as an invite
 * code to paste on a computer.
 */
export function inviteCode(serverUrl: string, invite: { username: string; token: string }): string {
  return `cellmate://join?s=${encodeURIComponent(normalizeServerUrl(serverUrl))}&u=${encodeURIComponent(invite.username)}&t=${encodeURIComponent(invite.token)}`;
}

/** What the admin sends a new person with their invite (email / chat apps). */
export function inviteMessage(name: string, code: string, serverUrl: string): { subject: string; body: string } {
  return {
    subject: 'Your CellMate account',
    body: [
      `Hi ${name || 'there'},`,
      '',
      'Your CellMate account is ready. To start:',
      '1. Install CellMate (Android app, Windows app, or on iPhone open ' + serverUrl.replace(/\/+$/, '') + '/app in Safari and tap Share > Add to Home Screen).',
      '2. Open it and choose "I have a QR invite".',
      '3. Scan the QR code, or paste this invite code:',
      '',
      code,
      '',
      '4. Choose your own password. Nobody else, not even your admin, will know it.',
      '',
      'The invite works once and expires in 7 days.',
    ].join('\n'),
  };
}

/** The same, for signing in with company code + ID + a temporary password (changed at the first sign-in). */
export function passwordMessage(name: string, company: string, id: string, password: string): { subject: string; body: string } {
  return {
    subject: 'Your CellMate sign-in',
    body: [
      `Hi ${name || 'there'},`,
      '',
      'Sign in to CellMate with:',
      company ? `Company code: ${company}` : '',
      `ID: ${id}`,
      `Temporary password: ${password}`,
      '',
      'At the first sign-in you choose your own password; this one stops working then.',
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n'),
  };
}

export function parseInviteCode(code: string): { serverUrl: string; username: string; token: string } | null {
  const m = code.trim().match(/^cellmate:\/\/join\?(.+)$/i);
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of m[1]!.split('&')) {
    const [k, v = ''] = part.split('=');
    try {
      params[k!] = decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  const serverUrl = params.s ?? '';
  const username = (params.u ?? '').toLowerCase();
  const token = params.t ?? '';
  if (!/^https?:\/\/\S+$/i.test(serverUrl) || !USERNAME_RE.test(username) || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  return { serverUrl: normalizeServerUrl(serverUrl), username, token };
}

/** The small line under a person's name: "Sales, Support · +91 98765 43210 · ravi@company.com" ('' when nothing is known). */
export function profileLine(p: { departments: string[]; phone: string; email: string } | undefined, opts: { email?: boolean } = {}): string {
  if (!p) return '';
  return [p.departments.join(', '), p.phone, opts.email === false ? '' : p.email].filter(Boolean).join(' · ');
}

/** Department names in use, A-Z, each listed once. */
export function departmentsOf(users: { departments: string[] }[]): string[] {
  const names = new Set(users.flatMap((u) => u.departments));
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Easy-to-read temporary password for new employees (no 0/O, 1/l/I). */
export function generatePassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length); // reject bytes above this: no modulo bias
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(32)) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const newId = () => bytesToHex(randomBytes(16));
/** The encrypted chat history file on this device (see history.ts). */
const HISTORY_DOC = 'history';
const PAD_BLOCK = 160; // hide exact message length, like Signal
const pad = (s: string) => s + ' '.repeat((PAD_BLOCK - (utf8(s).length % PAD_BLOCK)) % PAD_BLOCK);

function checkFile(f: OutgoingFile) {
  if (!f.data?.length) throw new Error('File is empty');
  if (f.data.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`);
  }
}

function validPointer(p: AttachmentPointer): boolean {
  return (
    typeof p === 'object' &&
    /^[0-9a-f]{32}$/.test(String(p.id)) &&
    typeof p.key === 'string' &&
    typeof p.digest === 'string' &&
    typeof p.name === 'string' &&
    typeof p.mime === 'string' &&
    /^[\w.+-]{1,64}\/[\w.+-]{1,100}$/.test(p.mime) && // used in data: URLs, so keep it strict
    p.name.length <= 1000 &&
    Number.isInteger(p.size) &&
    p.size > 0 &&
    p.size <= MAX_ATTACHMENT_BYTES
  );
}

function parseBundle(b: KeyBundleResponse): PreKeyBundle {
  return {
    identityKey: fromBase64(b.identityKey),
    signedPreKey: { id: b.signedPreKey.id, pub: fromBase64(b.signedPreKey.pub), sig: fromBase64(b.signedPreKey.sig) },
    oneTimePreKey: b.oneTimePreKey && { id: b.oneTimePreKey.id, pub: fromBase64(b.oneTimePreKey.pub) },
  };
}

/**
 * The whole messenger, UI-independent. Desktop (Electron) and mobile (React Native) both use this.
 * Keys + sessions go to encrypted SecureStorage. Message text lives ONLY in memory; photos and documents
 * are also kept encrypted on the device for each chat's "Media & docs" page (see MediaStore).
 */
export class MessengerClient extends Emitter<Events> {
  readonly store: ProtocolStore;
  private readonly media: MediaStore;
  private readonly cipher: SessionCipher;
  private readonly WS: typeof WebSocket;
  private readonly fetchImpl: typeof fetch;

  account: Account | null = null;
  contacts: string[] = [];
  status: ConnectionStatus = 'offline';
  activeChat: string | null = null;
  isAdmin = false;
  admins: string[] = [];
  /**
   * Old "save & share outside the app" right. Current servers always send false and current apps ignore it:
   * everyone may share files to other chats, nobody may take them outside.
   */
  canShare = false;
  /** Group chats I am in (managed by the admin). */
  groups: GroupInfo[] = [];
  policy: Policy = DEFAULT_POLICY;
  /** What I may do (see can()). */
  rights: MyRights = { all: { ...DEFAULT_RIGHTS }, groups: {} };
  /** Suspended by the admin: the app stays signed in but cannot connect until unbanned. */
  banned = false;
  /**
   * Moved to another company: this account is closed, but the app keeps everything. Joining with the new
   * company's QR invite (join()) carries this device's keys, chats and files over to the new account.
   */
  moved = false;
  /** My company asked to use this server and waits for the super admin's approval. */
  pending = false;
  /** My company (null = a server without companies). */
  company: { code: string; name: string } | null = null;
  /** May create companies and move people between them. */
  isSuper = false;

  private presence = new Map<string, Presence>();
  /** Profile photos as data: URLs, by user, with the version they belong to. */
  private avatars = new Map<string, { ver: number; url: string }>();
  private avatarLoading = new Map<string, number>();
  /** chat key -> who is typing there -> until when (ms) */
  private typing = new Map<string, Map<string, number>>();
  private lastTypingSent = new Map<string, number>();
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private lastGroupReload = 0;
  private chats = new Map<string, ChatMessage[]>();
  private notices: Notice[] = [];
  private starred: StarredMessage[] = [];
  private statuses: StatusUpdate[] = [];
  /** Colleagues' directory cards (department, mobile, email), with when they were fetched. */
  private profiles = new Map<string, { profile?: UserProfile; at: number; loading: boolean }>();
  /** Catalog photos as data: URLs, by "productId:version". */
  private productPhotos = new Map<string, Promise<string>>();
  /** Decrypted status photos, in memory only, by status id. */
  private statusPhotos = new Map<string, Promise<Uint8Array>>();
  private unread = new Map<string, number>();
  private timers: Record<string, number> = {};
  private locks = new Map<string, Promise<unknown>>();
  private pendingSends = new Map<string, { peer: string; msgId: string }>();
  private ws: WebSocket | null = null;
  private wantOnline = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Sealed sender: server key that signs certificates (trusted on first use) and my current certificate. */
  private certKey: Uint8Array | null = null;
  private certificate: SenderCertificate | null = null;

  constructor(storage: SecureStorage, opts: ClientOptions = {}) {
    super();
    this.store = new ProtocolStore(storage);
    this.cipher = new SessionCipher(this.store);
    this.media = new MediaStore(this.store, opts.blobs ?? new MemoryBlobStorage());
    this.WS = opts.WebSocket ?? globalThis.WebSocket;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    // Every change is saved to this device's encrypted history file (and from there to the backup).
    this.on('change', () => this.scheduleHistorySave());
  }

  /** Loads the saved account. Returns false if the user still has to register. */
  async init(): Promise<boolean> {
    this.account = await this.store.getAccount();
    this.contacts = await this.store.getContacts();
    this.timers = await this.store.getSetting<Record<string, number>>('timers', {});
    this.notices = await this.store.getSetting<Notice[]>('notices', []);
    this.statuses = await this.store.getSetting<StatusUpdate[]>('statuses', []);
    this.starred = await this.store.getSetting<StarredMessage[]>('starred', []);
    this.chatPrefs = await this.store.getSetting<Record<string, ChatPrefs>>('chatPrefs', {});
    this.privacy = { readReceipts: true, ...(await this.store.getSetting<Partial<{ readReceipts: boolean }>>('privacy', {})) };
    await this.media.load();
    if (this.account) await this.loadHistory();
    this.sweepTimer ??= setInterval(() => this.sweepExpired(), 1000);
    return !!this.account;
  }

  /**
   * Create an account myself (open servers, or the server owner's own first account). With `loginPassword` I can
   * sign in again later with my ID and that password; without it only this device can use the account.
   */
  async register(serverUrl: string, username: string, loginPassword?: string): Promise<void> {
    await this.registerAccount(serverUrl, username, { loginPassword });
  }

  /**
   * Ask the server owner for a company: creates the company (waiting for approval) and my account as its admin.
   * Until the owner approves it the app shows 'pending'; then I sign in with company code, ID and password.
   */
  async requestCompany(serverUrl: string, input: { companyCode: string; companyName: string; id: string; password: string }): Promise<void> {
    const code = input.companyCode.trim().toLowerCase();
    if (!COMPANY_CODE_RE.test(code)) throw new Error('Company code: 2-16 characters, a-z and 0-9 only');
    await this.registerAccount(serverUrl, input.id, {
      loginPassword: input.password,
      company: { code, name: input.companyName.trim() },
    });
  }

  private async registerAccount(
    serverUrl: string,
    id: string,
    opts: { loginPassword?: string; company?: { code: string; name: string } },
  ): Promise<void> {
    id = id.trim().toLowerCase();
    if (!ID_RE.test(id)) throw new Error('ID: 3-32 characters, a-z 0-9 _ .');
    if (opts.loginPassword !== undefined && opts.loginPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password: at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    serverUrl = normalizeServerUrl(serverUrl);
    const username = makeUsername(id, opts.company?.code ?? '');
    const { account, signedPreKey, oneTimePreKeys } = await createAccount(this.store, serverUrl, username);
    try {
      const body: RegisterRequest = {
        username: id,
        password: account.password,
        loginPassword: opts.loginPassword,
        company: opts.company,
        identityKey: toBase64(account.identity.pub),
        signedPreKey,
        oneTimePreKeys,
      };
      const res = await this.fetchImpl(`${serverUrl}/v1/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, res.status === 409 && !opts.company ? 'Username already taken' : await res.text());
    } catch (e) {
      await this.store.wipe();
      throw unreachable(serverUrl, e);
    }
    this.account = account;
    this.contacts = [];
    this.certificate = null; // issued for the previous account's key
    this.emit('change');
    if (opts.loginPassword) await this.afterSignIn(opts.loginPassword);
  }

  /** Public server settings (no account needed), e.g. whether self sign-up is allowed. */
  async getPublicConfig(serverUrl: string): Promise<PublicConfig> {
    const res = await this.fetchImpl(`${normalizeServerUrl(serverUrl)}/v1/config`);
    if (!res.ok) throw new ApiError(res.status, 'Cannot reach server');
    return (await res.json()) as PublicConfig;
  }

  /**
   * Log in with the ID + password the admin created. Fresh keys are generated on this device and only the
   * public halves go to the server. Throws MustChangePasswordError on first login - call again with `newPassword`.
   */
  async login(serverUrl: string, username: string, password: string, newPassword?: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Invalid ID');
    serverUrl = normalizeServerUrl(serverUrl);
    const { account, signedPreKey, oneTimePreKeys } = await createAccount(this.store, serverUrl, username);
    try {
      const body: LoginRequest = {
        username,
        password,
        newPassword,
        deviceSecret: account.password,
        identityKey: toBase64(account.identity.pub),
        signedPreKey,
        oneTimePreKeys,
      };
      const res = await this.fetchImpl(`${serverUrl}/v1/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 403 && text === 'must_change') throw new MustChangePasswordError();
        throw new ApiError(res.status, text || res.statusText);
      }
    } catch (e) {
      await this.store.wipe();
      throw unreachable(serverUrl, e);
    }
    this.account = account;
    this.contacts = [];
    this.certificate = null; // issued for the previous account's key
    this.emit('change');
    await this.afterSignIn(newPassword ?? password);
  }

  /** My own profile as colleagues see it (name, mobile, email). Only an admin can change it. */
  async getMyContactInfo(): Promise<{ name: string; phone: string; email: string }> {
    const me = await this.http<MeResponse>('GET', '/v1/me');
    return { name: me.name ?? '', phone: me.phone ?? '', email: me.email ?? '' };
  }

  /** Change my own mobile number / email ('' clears it). */
  async setMyContactInfo(phone: string, email: string): Promise<void> {
    await this.http('PUT', '/v1/me/contact', { phone: phone.trim(), email: email.trim() });
    if (this.account) this.profiles.delete(this.account.username);
    this.emit('change');
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.http('POST', '/v1/password', { oldPassword, newPassword });
    // The chat backup opens with the login password: lock its key with the new one.
    if (this.backupKeys) {
      this.backupKeys = await lockBackupKey(fromBase64(this.backupKeys.key), newPassword);
      await this.store.setSetting('backupKeys', this.backupKeys);
      this.backedUpJson = '';
      await this.uploadBackup().catch((e) => console.warn('backup failed', e));
    }
  }

  /**
   * Register this device for wake-up pushes (Firebase Cloud Messaging token), or pass null to stop them.
   * Pushes never carry message content or the sender: they only say "New message" / "Incoming call".
   */
  async setPushToken(token: string | null, opts: { callUi?: boolean } = {}): Promise<void> {
    if (token) await this.http('PUT', '/v1/push', { token, ...(opts.callUi ? { callUi: true } : {}) } satisfies PushTokenRequest);
    else await this.http('DELETE', '/v1/push');
  }

  // ------------------------------------------------------------------ admin: employees

  async createEmployee(
    username: string,
    password: string,
    departments: string[] = [],
    opts: { canShare?: boolean; phone?: string; email?: string } = {},
  ): Promise<void> {
    const body = {
      username: username.trim().toLowerCase(),
      password,
      departments,
      canShare: opts.canShare,
      phone: opts.phone?.trim() || undefined,
      email: opts.email?.trim() || undefined,
    };
    await this.http('POST', '/v1/admin/users', body);
  }

  /**
   * Admin: create a user with their whole profile (name, mobile, email, photo, departments). Returns a one-time
   * QR invite (show it with inviteCode()); the person scans it and only chooses their password.
   */
  async inviteEmployee(input: EmployeeInput): Promise<InviteResponse> {
    const body = { ...input, username: input.username.trim().toLowerCase(), name: input.name.trim() };
    return (await this.http<{ invite: InviteResponse }>('POST', '/v1/admin/users', body)).invite;
  }

  /** Admin: a new QR invite for a user (the old one stops working). Also moves someone to a new phone. */
  newInvite(username: string): Promise<InviteResponse> {
    return this.http<InviteResponse>('POST', `/v1/admin/users/${encodeURIComponent(username)}/invite`);
  }

  /** Admin: change a user's name / mobile / email (fields left out stay). Users can't change these themselves. */
  async setEmployeeProfile(username: string, p: { name?: string; phone?: string; email?: string }): Promise<void> {
    await this.http('PUT', `/v1/admin/users/${encodeURIComponent(username)}/profile`, p);
    this.profiles.delete(username);
    this.emit('change');
  }

  /** Admin: set (or with null remove) a user's profile photo. */
  async setEmployeeAvatar(username: string, photo: { mime: string; data: Uint8Array } | null): Promise<void> {
    // Same checks as setMyAvatar, before uploading (the server would cut off a too-large upload mid-way).
    if (photo && !(AVATAR_MIMES as readonly string[]).includes(photo.mime)) throw new Error('Photo must be JPEG, PNG or WebP');
    if (photo && photo.data.length > MAX_AVATAR_BYTES) throw new Error('Photo too large (max 2 MB)');
    const path = `/v1/admin/users/${encodeURIComponent(username)}/avatar`;
    if (photo) await this.http('PUT', path, { mime: photo.mime, data: toBase64(photo.data) });
    else await this.http('DELETE', path);
    this.avatars.delete(username);
    this.emit('change');
  }

  /**
   * Accept a QR invite on this device: choose my own password; this device's keys are created and registered.
   * `code` is what the QR contains (or the invite code the admin copied).
   */
  async join(code: string, newPassword: string): Promise<void> {
    const invite = parseInviteCode(code);
    if (!invite) throw new Error('That is not a CellMate invite. Scan the QR code your admin gave you.');
    if (this.account && this.moved) return this.moveToInvite(invite, newPassword);
    const { serverUrl, username, token } = invite;
    const { account, signedPreKey, oneTimePreKeys } = await createAccount(this.store, serverUrl, username);
    try {
      const body: JoinRequest = {
        username,
        token,
        newPassword,
        deviceSecret: account.password,
        identityKey: toBase64(account.identity.pub),
        signedPreKey,
        oneTimePreKeys,
      };
      const res = await this.fetchImpl(`${serverUrl}/v1/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
    } catch (e) {
      await this.store.wipe();
      throw unreachable(serverUrl, e);
    }
    this.account = account;
    this.contacts = [];
    this.certificate = null; // issued for the previous account's key
    this.emit('change');
    await this.afterSignIn(newPassword);
  }

  /**
   * After being moved to another company: join the new account with THIS device's identity, so its chats,
   * contacts, starred messages and saved files all stay (and colleagues who already know me see no key change).
   * Nothing is deleted if it fails.
   */
  private async moveToInvite(invite: { serverUrl: string; username: string; token: string }, newPassword: string): Promise<void> {
    const old = this.account!;
    const spks = await this.store.getSignedPreKeys();
    const spk = makeSignedPreKey(old, spks.reduce((n, r) => Math.max(n, r.id), 0) + 1);
    const oneTimePreKeys = await generateOneTimePreKeys(this.store, ONE_TIME_PREKEY_BATCH);
    const account: Account = { ...old, serverUrl: invite.serverUrl, username: invite.username, password: toBase64(randomBytes(32)) };
    const body: JoinRequest = {
      username: invite.username,
      token: invite.token,
      newPassword,
      deviceSecret: account.password,
      identityKey: toBase64(old.identity.pub),
      signedPreKey: publicSpk(spk),
      oneTimePreKeys,
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${invite.serverUrl}/v1/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw unreachable(invite.serverUrl, e);
    }
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
    await this.store.saveSignedPreKeys([spk, ...spks.sort((a, b) => b.id - a.id)].slice(0, 3));
    await this.store.saveAccount(account);
    this.disconnect();
    this.account = account;
    this.moved = false;
    this.banned = false;
    this.certificate = null;
    this.isAdmin = false;
    this.admins = [];
    this.groups = [];
    this.profiles.clear();
    this.presence.clear();
    this.emit('change');
    // The chats stay; the new account gets its own backup, locked with the new password.
    this.backupKeys = await newBackupKeys(newPassword);
    await this.store.setSetting('backupKeys', this.backupKeys);
  }

  /** Admin: make someone an admin of our company too, or take it away (a company keeps at least one admin). */
  async setUserAdmin(username: string, admin: boolean): Promise<void> {
    await this.http('PUT', `/v1/admin/users/${encodeURIComponent(username)}/admin`, { admin });
  }

  /** Admin: a user's work mobile number and email ('' clears it). */
  async setContactInfo(username: string, phone: string, email: string): Promise<void> {
    await this.http('PUT', `/v1/admin/users/${encodeURIComponent(username)}/contact`, { phone: phone.trim(), email: email.trim() });
    this.profiles.delete(username);
    this.emit('change');
  }

  /**
   * A colleague's directory card (departments, mobile, email), for the small line under their name. Returns
   * what is cached and refreshes it in the background (at most every 5 minutes); emits 'change' when it arrives.
   */
  profileOf(username: string): UserProfile | undefined {
    const p = this.profiles.get(username);
    if (!p || (Date.now() - p.at > 300_000 && !p.loading)) void this.loadProfile(username);
    return p?.profile;
  }

  private async loadProfile(username: string): Promise<void> {
    if (!USERNAME_RE.test(username) || !this.account) return;
    const old = this.profiles.get(username);
    this.profiles.set(username, { profile: old?.profile, at: old?.at ?? 0, loading: true });
    try {
      const profile = await this.http<UserProfile>('GET', `/v1/users/${encodeURIComponent(username)}`);
      this.profiles.set(username, { profile, at: Date.now(), loading: false });
      this.emit('change');
    } catch {
      this.profiles.set(username, { profile: old?.profile, at: Date.now(), loading: false });
    }
  }

  /** Allow (or stop) an employee saving received files and sharing them on. Takes effect on their device at once. */
  async setCanShare(username: string, canShare: boolean): Promise<void> {
    await this.http('PUT', `/v1/admin/users/${encodeURIComponent(username)}/share`, { canShare });
  }

  /**
   * Share a file on to another chat (1:1 or group), freshly encrypted for it. Everyone may do this: files can
   * move between chats inside the app, but the apps offer no way to save or share them outside it.
   */
  async forwardAttachment(to: string, a: Attachment, from?: string): Promise<void> {
    if (!this.can('forward', from)) throw new Error('Your admin has turned off forwarding');
    if (!this.can('sendFiles', to)) throw new Error('Your admin has turned off sending files there');
    if (!a.data) throw new Error('The file is not available');
    await this.sendMessage(to, '', { file: { name: a.name, mime: a.mime, data: a.data }, forwarded: true });
  }

  /** The department list admins pick from (A-Z). */
  async listDepartments(): Promise<string[]> {
    return (await this.http<{ departments: string[] }>('GET', '/v1/admin/departments')).departments;
  }

  async addDepartment(name: string): Promise<string[]> {
    return (await this.http<{ departments: string[] }>('POST', '/v1/admin/departments', { name })).departments;
  }

  /** Renames it for everyone in it too. */
  async renameDepartment(from: string, to: string): Promise<string[]> {
    const path = `/v1/admin/departments/${encodeURIComponent(from)}`;
    return (await this.http<{ departments: string[] }>('PUT', path, { name: to })).departments;
  }

  /** Removes it from the list and from everyone in it; the people stay. */
  async deleteDepartment(name: string): Promise<string[]> {
    const path = `/v1/admin/departments/${encodeURIComponent(name)}`;
    return (await this.http<{ departments: string[] }>('DELETE', path)).departments;
  }

  /** Put an employee in these departments (from the list); [] = none. */
  async setDepartments(username: string, departments: string[]): Promise<void> {
    await this.http('PUT', `/v1/admin/users/${encodeURIComponent(username)}/departments`, { departments });
  }

  /** New temporary password; the employee must choose their own at next login. */
  async resetEmployeePassword(username: string, password: string): Promise<void> {
    await this.http('POST', `/v1/admin/users/${encodeURIComponent(username)}/password`, { password });
  }

  async removeEmployee(username: string): Promise<void> {
    await this.http('DELETE', `/v1/admin/users/${encodeURIComponent(username)}`);
  }

  /** Suspend (or lift the suspension of) an account. Banned users are signed out at once and can't log in. */
  async setBanned(username: string, banned: boolean): Promise<void> {
    await this.http('POST', `/v1/admin/users/${encodeURIComponent(username)}/ban`, { banned });
  }

  getAdminStats(): Promise<AdminStats> {
    return this.http<AdminStats>('GET', '/v1/admin/stats');
  }

  async getAuditLog(limit = 200): Promise<AuditEntry[]> {
    return (await this.http<{ entries: AuditEntry[] }>('GET', `/v1/admin/audit?limit=${limit}`)).entries;
  }

  /** One page of the activity log, newest first. Pass the previous page's `next` to get the one after it. */
  async getAuditPage(before?: number | null, limit = 50): Promise<Page<AuditEntry>> {
    const q = `limit=${limit}${before ? `&before=${before}` : ''}`;
    const r = await this.http<Partial<Page<AuditEntry>> & { entries?: AuditEntry[] }>('GET', `/v1/admin/audit?${q}`);
    const items = r.items ?? r.entries ?? [];
    // Older servers send everything at once, without `next`.
    return { items, next: r.next === undefined ? null : r.next };
  }

  // ------------------------------------------------------------------ rights

  /** Company admin: every rule. With `groupId`: that group's rules (its group admins may read them too). */
  async getRightRules(groupId?: string): Promise<RightRule[]> {
    return (await this.http<{ rules: RightRule[] }>('GET', `/v1/rights${groupId ? `?group=${groupId}` : ''}`)).rules;
  }

  /** Allow / block a function for someone, or with allow null go back to what applies above it. */
  async setRight(change: RightChange): Promise<RightRule[]> {
    return (await this.http<{ rules: RightRule[] }>('PUT', '/v1/rights', change)).rules;
  }

  /** Group admins (and company admins): change a group's name, members, senders or group admins. */
  async updateMyGroup(id: string, changes: { name?: string; members?: string[]; senders?: string[] | null; admins?: string[] }): Promise<GroupInfo> {
    const g = await this.http<GroupInfo>('PUT', `/v1/groups/${id}`, changes);
    await this.loadGroups().catch(() => {});
    return g;
  }

  // ------------------------------------------------------------------ channels and communities

  /** Every channel of my company (to follow or leave). */
  async listChannels(): Promise<ChannelInfo[]> {
    return (await this.http<{ channels: ChannelInfo[] }>('GET', '/v1/channels')).channels;
  }

  async followChannel(id: string, follow: boolean): Promise<void> {
    await this.http('POST', `/v1/channels/${id}/follow`, { follow });
    await this.loadGroups().catch(() => {});
  }

  /** Communities: groups and channels put together by the company admin. */
  async listCommunities(): Promise<Community[]> {
    return (await this.http<{ communities: Community[] }>('GET', '/v1/communities')).communities;
  }

  /** Company admin: replace the list of communities. */
  async setCommunities(list: (Omit<Community, 'id'> & { id?: string })[]): Promise<Community[]> {
    return (await this.http<{ communities: Community[] }>('PUT', '/v1/admin/communities', { communities: list })).communities;
  }

  isChannel(key: string): boolean {
    return this.groupOf(key)?.kind === 'channel';
  }

  // ------------------------------------------------------------------ help desk

  /** Whom to contact for what (the company admin keeps the list). */
  async getHelpDesk(): Promise<HelpContact[]> {
    return (await this.http<{ contacts: HelpContact[] }>('GET', '/v1/helpdesk')).contacts;
  }

  /** Company admin: replace the help desk list. */
  async setHelpDesk(contacts: (HelpContactInput & { id?: string })[]): Promise<HelpContact[]> {
    return (await this.http<{ contacts: HelpContact[] }>('PUT', '/v1/admin/helpdesk', { contacts })).contacts;
  }

  /** Every group on the server, including ones the admin is not in. */
  async listAllGroups(): Promise<GroupInfo[]> {
    return (await this.http<{ groups: GroupInfo[] }>('GET', '/v1/admin/groups')).groups;
  }

  /** `senders`: who may send (admins always may); null/omitted = every member. */
  /** kind: 'channel': one-way, anyone in the company may follow it, only its admins post. */
  createGroup(name: string, members: string[], senders: string[] | null = null, admins: string[] = [], kind: 'group' | 'channel' = 'group'): Promise<GroupInfo> {
    return this.http<GroupInfo>('POST', '/v1/admin/groups', { name, members, senders, admins, kind });
  }

  /** `admins`: the group's own admins (members who may manage it). */
  updateGroup(id: string, changes: { name?: string; members?: string[]; senders?: string[] | null; admins?: string[] }): Promise<GroupInfo> {
    return this.http<GroupInfo>('PUT', `/v1/admin/groups/${encodeURIComponent(id)}`, changes);
  }

  async deleteGroup(id: string): Promise<void> {
    await this.http('DELETE', `/v1/admin/groups/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ company catalog

  /** A catalog, A-Z: mine, or a colleague's (like opening a WhatsApp Business catalog from their profile). */
  async listProducts(owner?: string): Promise<Product[]> {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    return (await this.http<{ products: Product[] }>('GET', `/v1/catalog${q}`)).products;
  }

  /** A product photo as a data: URL (cached per photo version). */
  async productPhoto(p: Product): Promise<string | null> {
    if (p.photo === null) return null;
    const key = `${p.id}:${p.photo}`;
    let url = this.productPhotos.get(key);
    if (!url) {
      url = this.http<{ mime: string; data: string }>('GET', `/v1/catalog/${p.id}/photo`).then((r) =>
        (AVATAR_MIMES as readonly string[]).includes(r.mime) ? `data:${r.mime};base64,${r.data}` : '',
      );
      url.catch(() => this.productPhotos.delete(key));
      this.productPhotos.set(key, url);
    }
    return (await url) || null;
  }

  /** Add a product to my catalog. */
  createProduct(input: ProductInput): Promise<Product> {
    return this.http<Product>('POST', '/v1/catalog', input);
  }

  /** Change one of my products (fields left out stay as they are; photo null removes it). */
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product> {
    return this.http<Product>('PUT', `/v1/catalog/${encodeURIComponent(id)}`, input);
  }

  /** Delete one of my products (admins may also remove anyone's). */
  async deleteProduct(id: string): Promise<void> {
    await this.http('DELETE', `/v1/catalog/${encodeURIComponent(id)}`);
  }

  async setPolicy(policy: Partial<Policy>): Promise<void> {
    this.policy = await this.http<Policy>('PUT', '/v1/admin/settings', policy);
    this.emit('change');
  }

  // ------------------------------------------------------------------ connection

  connect(): void {
    this.wantOnline = true;
    this.openSocket();
  }

  disconnect(): void {
    this.wantOnline = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  /** Stop all timers (call when the app is closing). */
  dispose(): void {
    this.disconnect();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    // Pending saves are dropped (call flushHistory() first to keep them).
    if (this.historyTimer) clearTimeout(this.historyTimer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.historyTimer = this.backupTimer = null;
    this.historyLoaded = false;
  }

  private stopPresence() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.emit('change');
  }

  private openSocket() {
    if (!this.account || this.ws) return;
    this.setStatus('connecting');
    const url = this.account.serverUrl.replace(/^http/, 'ws') + '/v1/ws';
    const ws = new this.WS(url);
    this.ws = ws;
    ws.onopen = () =>
      this.sendFrame({ type: 'auth', username: this.account!.username, password: this.account!.password });
    ws.onmessage = (ev: { data?: unknown }) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      void this.onFrame(frame);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.stopPresence();
      for (const { peer, msgId } of this.pendingSends.values()) this.setMsgStatus(peer, msgId, 'failed');
      this.pendingSends.clear();
      this.setStatus('offline');
      if (this.wantOnline) {
        // While suspended, check back once a minute so an unban takes effect without restarting the app.
        const delay = this.banned || this.moved || this.pending ? 60_000 : Math.min(30_000, 1000 * 2 ** this.retry++);
        this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
      }
    };
  }

  private sendFrame(f: ClientFrame) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('You are offline');
    this.ws.send(JSON.stringify(f));
  }

  private async onFrame(f: ServerFrame) {
    switch (f.type) {
      case 'ready':
        this.retry = 0;
        this.setStatus('online');
        this.pingTimer = setInterval(() => this.ws?.readyState === 1 && this.sendFrame({ type: 'ping' }), 25_000);
        // Arrives before any queued envelope, so the 📢 badge check below always has the admin list.
        this.isAdmin = !!f.isAdmin;
        this.canShare = !!f.canShare;
        if (this.account) this.noteAvatar(this.account.username, f.avatar ?? null);
        this.admins = Array.isArray(f.admins) ? f.admins : [];
        this.policy = { ...DEFAULT_POLICY, ...f.policy };
        this.setRights(f.rights);
        this.banned = false;
        this.moved = false;
        this.pending = false;
        this.emit('change');
        void this.loadMe();
        this.maintainKeys(f.preKeyCount).catch((e) => this.emit('error', `Key upload failed: ${e.message}`));
        this.setupSealedSender().catch((e) => console.warn('sealed sender unavailable', e));
        this.followServerMove().catch((e) => console.warn('server address check failed', e));
        this.loadGroups().catch((e) => console.warn('groups unavailable', e));
        void this.sendNoticeOks();
        this.stopPresence();
        this.presenceTimer = setInterval(() => void this.refreshPresence(), 30_000);
        void this.refreshPresence();
        break;
      case 'refresh':
        if (f.what === 'groups') await this.loadGroups().catch((e) => console.warn('groups unavailable', e));
        // Group changes can change my rights inside those groups too.
        await this.loadMe();
        break;
      case 'envelope':
        if (!f.from && isSealed(f.body)) {
          const opened = await this.openSealed(f.body);
          if (opened) {
            await this.withLock(opened.from, () => this.handleEnvelope(opened.from, opened.body, f.ts, opened.identity));
          }
        } else {
          await this.withLock(f.from, () => this.handleEnvelope(f.from, f.body, f.ts));
        }
        if (this.ws?.readyState === 1) this.sendFrame({ type: 'ack', id: f.id });
        break;
      case 'sent': {
        const p = this.pendingSends.get(f.ref);
        if (p) {
          this.pendingSends.delete(f.ref);
          this.setMsgStatus(p.peer, p.msgId, 'sent');
        }
        break;
      }
      case 'error':
        if (f.ref) {
          const p = this.pendingSends.get(f.ref);
          if (p) {
            this.pendingSends.delete(f.ref);
            this.setMsgStatus(p.peer, p.msgId, 'failed');
          }
        }
        if (f.code === 'pending' && !f.ref) {
          // My company is waiting for approval: keep everything and check back every minute.
          const first = !this.pending;
          this.pending = true;
          this.emit('change');
          if (first) this.emit('error', f.message);
          break;
        }
        if (f.code === 'moved' && !f.ref) {
          // Moved to another company. Everything stays on this device until the new QR invite is used.
          const first = !this.moved;
          this.moved = true;
          this.emit('change');
          if (first) this.emit('error', f.message);
          break;
        }
        if (f.code === 'banned' && !f.ref) {
          // Suspended by the admin. Keys stay on this device, so an unban restores everything.
          const first = !this.banned;
          this.banned = true;
          this.emit('change');
          if (first) this.emit('error', f.message);
          break;
        }
        if (f.code === 'unavailable') break; // server busy or restarting: the socket closes and reconnects
        if (f.code === 'auth') {
          // This device was signed out (account used on another device, password reset login, or removed).
          // Its keys are useless now, so wipe them and go back to the login screen. Wiping can't be undone,
          // so double-check first: only a definite 401 counts, not a server that is restarting or busy.
          const signedOut = await this.http('GET', '/v1/me').then(
            () => false,
            (e) => e instanceof ApiError && e.status === 401,
          );
          if (!signedOut) break;
          this.wantOnline = false;
          this.emit('error', 'You were logged out. Log in again with your ID and password.');
          await this.wipeLocal();
          break;
        }
        this.emit('error', f.message);
        break;
    }
  }

  /** My role and company, the admin list and the policy (they change when an admin changes them). */
  private async loadMe(): Promise<void> {
    const me = await this.http<MeResponse>('GET', '/v1/me').catch(() => null);
    if (!me) return;
    this.policy = { ...DEFAULT_POLICY, ...me.policy };
    this.canShare = !!me.canShare;
    this.isAdmin = !!me.isAdmin;
    this.admins = Array.isArray(me.admins) ? me.admins : [];
    this.company = me.company ?? null;
    this.isSuper = !!me.isSuper;
    this.about = me.about ?? '';
    this.hideLastSeen = !!me.hideLastSeen;
    this.setRights(me.rights);
    this.emit('change');
  }

  /** Older servers send no rights: then the defaults apply, with the old company switches. */
  private setRights(r: MyRights | undefined) {
    const base: Rights = { ...DEFAULT_RIGHTS, editDelete: this.policy.allowEditDelete, clearHistory: this.policy.allowClearHistory };
    this.rights = r && typeof r === 'object' && r.all ? { all: { ...base, ...r.all }, groups: r.groups ?? {} } : { all: base, groups: {} };
  }

  /**
   * May I use this function, in this chat (a group's chat may differ)? Company admins always may.
   * The apps hide or block what is not allowed.
   */
  can(feature: Feature, chat?: string | null): boolean {
    if (this.isAdmin) return true;
    const g = chat && isGroupKey(chat) ? this.rights.groups[groupIdOf(chat)] : undefined;
    return g?.[feature] ?? this.rights.all[feature];
  }

  /** May I manage this group (company admin, or one of its group admins)? */
  isGroupAdmin(key: string): boolean {
    const g = this.groupOf(key);
    const me = this.account?.username;
    return !!g && !!me && (this.isAdmin || (g.admins ?? []).includes(me));
  }

  private async maintainKeys(serverCount: number) {
    const upload: UploadKeysRequest = {};
    const spk = await maybeRotateSignedPreKey(this.store);
    if (spk) upload.signedPreKey = spk;
    if (serverCount < ONE_TIME_PREKEY_LOW_WATER) {
      upload.oneTimePreKeys = await generateOneTimePreKeys(this.store, ONE_TIME_PREKEY_BATCH);
    }
    if (upload.signedPreKey || upload.oneTimePreKeys) await this.http('PUT', '/v1/keys', upload);
  }

  /** `body` that is a string is sent as-is with `contentType`; otherwise as JSON. `rawText` returns the body text. */
  private async http<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
    rawText = false,
  ): Promise<T> {
    const a = this.account;
    if (!a) throw new Error('not registered');
    const isText = typeof body === 'string' && !!contentType;
    const res = await this.fetchImpl(a.serverUrl + path, {
      method,
      headers: {
        'content-type': isText ? contentType! : 'application/json',
        authorization: 'Basic ' + toBase64(utf8(`${a.username}:${a.password}`)),
      },
      body: body === undefined ? undefined : isText ? (body as string) : JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
    const text = await res.text();
    if (rawText) return text as T;
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  // ------------------------------------------------------------------ receiving

  private async handleEnvelope(from: string, body: string, ts: number, expectedIdentity?: Uint8Array) {
    let payload: Payload;
    try {
      const wire = JSON.parse(body) as WireMessage;
      const { plaintext, identityStatus } = await this.cipher.decrypt(from, wire, expectedIdentity);
      if (identityStatus === 'changed') this.onIdentityChanged(from);
      payload = JSON.parse(plaintext) as Payload;
    } catch (e) {
      if (e instanceof DuplicateMessageError) return; // re-delivery of a message we already have
      console.warn('decrypt failed', e);
      this.addContactLocal(from);
      this.addSystem(from, 'A message from this contact could not be decrypted. Try "Reset session".');
      return;
    }
    await this.handlePayload(from, payload, ts);
  }

  /**
   * Which chat a payload belongs to: the sender's 1:1 chat, or a group chat - but only if the server's
   * member list (set by the admin) says the sender really is in that group. null = drop it.
   */
  private async chatKeyFor(from: string, g: unknown): Promise<string | null> {
    if (g === undefined) return from;
    if (typeof g !== 'string' || !GROUP_ID_RE.test(g)) return null;
    const isMember = () => this.groups.some((x) => x.id === g && x.members.includes(from));
    if (!isMember() && Date.now() - this.lastGroupReload > 3000) await this.loadGroups().catch(() => {});
    return isMember() ? groupKey(g) : null;
  }

  /** Edits and deletes for everyone: from admins always, from others only when the admin allows it. */
  private mayEditDelete(user: string): boolean {
    return this.admins.includes(user) || this.policy.allowEditDelete || !!this.profiles.get(user)?.profile?.editDelete;
  }

  /** Disappearing-message timers: from admins always, from others only when the admin allows clearing history. */
  private mayClearHistory(user: string): boolean {
    return this.admins.includes(user) || this.policy.allowClearHistory;
  }

  private async handlePayload(from: string, p: Payload, ts: number) {
    switch (p.k) {
      case 'text':
      case 'poll':
      case 'event': {
        if (typeof p.id !== 'string' || !p.id || p.id.length > 64) return;
        let text = '';
        let att: AttachmentPointer | undefined;
        let poll: Poll | undefined;
        let event: ChatEvent | undefined;
        let extra: Partial<ChatMessage> = {};
        if (p.k === 'text') {
          if (typeof p.text !== 'string' || p.text.length > MAX_TEXT_LENGTH) return;
          text = p.text;
          att = p.att && validPointer(p.att) ? p.att : undefined;
          extra = {
            replyTo: cleanQuote(p.re),
            contact: typeof p.contact === 'string' && USERNAME_RE.test(p.contact) ? p.contact : undefined,
            location: cleanLocation(p.loc),
            product: cleanProduct(p.product),
            forwarded: p.fwd === true || undefined,
            // Only photos / videos can be view-once.
            viewOnce: p.vo === true && !!att && /^(image|video)\//.test(att.mime) ? true : undefined,
          };
          if (!text && !att && !extra.contact && !extra.location && !extra.product) return;
        } else if (p.k === 'poll') {
          poll = cleanPoll(p.q, p.opts, p.multi) ?? undefined;
          if (!poll) return;
        } else {
          event = cleanEvent(p) ?? undefined;
          if (!event) return;
        }
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        const group = key !== from;
        // Read-only member of a group where only some may send: drop it (a modified app could try).
        if (group && !(await this.mayPost(key, from))) return;
        if (group && Array.isArray((p as { mn?: unknown }).mn)) {
          const members = this.groupOf(key)?.members ?? [];
          const mn = ((p as { mn: unknown[] }).mn).filter((u): u is string => typeof u === 'string' && members.includes(u)).slice(0, 50);
          if (mn.length) extra.mentions = mn;
        }
        this.clearTyping(key, from);
        let expire = 0;
        if (!group) {
          this.addContactLocal(from);
          expire = typeof p.expire === 'number' && p.expire > 0 && this.mayClearHistory(from) ? p.expire : 0;
          if (expire !== (this.timers[from] ?? 0)) await this.applyTimer(from, expire, from);
        }
        const msg: ChatMessage = {
          id: p.id,
          peer: key,
          from: group ? from : undefined,
          text,
          ts,
          outgoing: false,
          expiresAt: expire ? Date.now() + expire * 1000 : undefined,
          // Only trust the announcement flag from real admins.
          broadcast: p.k === 'text' && p.bc === true && this.admins.includes(from) ? true : undefined,
          poll,
          event,
          ...extra,
        };
        if (att) {
          const name = safeFileName(att.name);
          msg.attachment = {
            name,
            mime: att.mime,
            size: att.size,
            kind: attachmentKind(att.mime, name),
            state: 'downloading',
            ptr: att,
          };
          void this.fetchAttachment(msg, att);
        }
        const chat = this.chatOf(key);
        if (chat.some((m) => m.id === p.id && !m.outgoing)) return; // same message twice
        chat.push(msg);
        // A new message brings an archived chat back to the list (unless it is muted), like WhatsApp.
        if (this.chatPrefs[key]?.archived && !this.isMuted(key)) this.setChatPref(key, { archived: false });
        const isOpen = this.activeChat === key;
        if (!isOpen) this.unread.set(key, (this.unread.get(key) ?? 0) + 1);
        msg.receiptSent = isOpen && this.privacy.readReceipts ? 'read' : 'delivered';
        // Receipts only in 1:1 chats (in groups they would tell every member who read what).
        if (!group) this.sendPayload(from, { k: 'receipt', ids: [p.id], status: msg.receiptSent }).catch(() => {});
        this.emit('message', msg);
        this.emit('change');
        break;
      }
      case 'react': {
        if (typeof p.id !== 'string' || typeof p.e !== 'string') return;
        if (p.e && !(REACTIONS as readonly string[]).includes(p.e)) return;
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        const m = this.chats.get(key)?.find((x) => x.id === p.id && !x.deleted && !x.system);
        if (!m) return;
        m.reactions = { ...m.reactions, [from]: p.e };
        if (!p.e) delete m.reactions[from];
        this.emit('change');
        break;
      }
      case 'vote':
      case 'rsvp': {
        if (typeof p.id !== 'string') return;
        // Anyone in the chat may answer, also read-only group members (like WhatsApp).
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        const m = this.chats.get(key)?.find((x) => x.id === p.id && !x.deleted);
        if (p.k === 'vote') {
          if (!m?.poll || !validVote(m.poll, p.ch)) return;
          m.poll.votes = { ...m.poll.votes, [from]: p.ch };
          if (!p.ch.length) delete m.poll.votes[from];
        } else {
          if (!m?.event || (p.r !== 'yes' && p.r !== 'maybe' && p.r !== 'no')) return;
          m.event.rsvp = { ...m.event.rsvp, [from]: p.r };
        }
        this.emit('change');
        break;
      }
      case 'edit': {
        if (typeof p.id !== 'string' || typeof p.text !== 'string' || !p.text.trim() || p.text.length > MAX_TEXT_LENGTH) return;
        if (!this.mayEditDelete(from)) return;
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        // Only the author can edit, so the message must have come from `from`.
        const m = this.chats.get(key)?.find((x) => x.id === p.id && !x.outgoing && (x.from ?? x.peer) === from);
        if (!m || m.deleted || m.poll || m.event) return; // polls and events can't be edited
        m.text = p.text;
        m.edited = true;
        this.emit('change');
        break;
      }
      case 'del': {
        if (typeof p.id !== 'string' || !this.mayEditDelete(from)) return;
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        // Authors delete their own messages; admins may also remove anyone's (moderation).
        const m = this.chats.get(key)?.find((x) => x.id === p.id && !x.system);
        if (!m) {
          // The app restarted since: the message is gone from memory, but its saved file must go too.
          const saved = this.media.list(key).find((x) => x.msgId === p.id);
          if (saved && (saved.from === from || this.admins.includes(from))) this.forgetMedia(key, p.id);
          return;
        }
        const author = m.outgoing ? this.account?.username : (m.from ?? m.peer);
        if (author !== from && !this.admins.includes(from)) return;
        this.markDeleted(m);
        break;
      }
      case 'typing': {
        if (Date.now() - ts > 10_000) return; // stale (was queued while I was offline)
        const key = await this.chatKeyFor(from, p.g);
        if (!key) return;
        if (p.on) {
          let who = this.typing.get(key);
          if (!who) this.typing.set(key, (who = new Map()));
          who.set(from, Date.now() + TYPING_SHOW_MS);
          this.emit('change');
        } else {
          this.clearTyping(key, from);
        }
        break;
      }
      case 'receipt': {
        if (!Array.isArray(p.ids)) return;
        const ids = new Set(p.ids);
        // With my read receipts off I don't see other people's either (like WhatsApp).
        const status = p.status === 'read' && !this.privacy.readReceipts ? 'delivered' : p.status;
        for (const m of this.chatOf(from)) {
          if (!m.outgoing || !ids.has(m.id)) continue;
          if (p.status === 'delivered' || p.status === 'read') m.deliveredAt ??= ts;
          if (status === 'read') m.readAt ??= ts;
          if (m.status !== 'read') m.status = status;
        }
        this.emit('change');
        break;
      }
      case 'opened': {
        // They opened my view-once photo: show "Opened".
        if (typeof p.id !== 'string') return;
        const key = await this.chatKeyFor(from, p.g);
        const m = key && this.chats.get(key)?.find((x) => x.id === p.id && x.outgoing && x.viewOnce);
        if (m && !isGroupKey(key)) {
          m.opened = true;
          this.emit('change');
        }
        break;
      }
      case 'timer':
        // Turning it off is always fine; turning it on only from someone allowed to make history disappear.
        if (typeof p.expire === 'number' && (p.expire <= 0 || this.mayClearHistory(from))) {
          await this.applyTimer(from, Math.max(0, p.expire), from);
        }
        break;
      case 'screenshot':
        this.addSystem(from, `${from} took a screenshot.`);
        break;
      case 'notice': {
        // Only admins send notices; a modified app could try to make one pop up.
        if (!this.admins.includes(from) || typeof p.id !== 'string' || !/^[0-9a-f]{32}$/.test(p.id)) return;
        if (typeof p.title !== 'string' || typeof p.text !== 'string') return;
        const title = p.title.trim();
        const text = p.text.trim();
        if ((!title && !text) || title.length > MAX_NOTICE_TITLE || text.length > MAX_TEXT_LENGTH) return;
        if (this.notices.some((n) => n.id === p.id && n.from === from)) return; // same notice twice
        const notice: Notice = { id: p.id, from, title, text, ts, outgoing: false };
        this.notices.push(notice);
        await this.saveNotices();
        this.emit('notice', notice);
        this.emit('change');
        break;
      }
      case 'notice-ok': {
        const n = this.notices.find((x) => x.outgoing && x.id === p.id);
        if (!n?.recipients?.includes(from) || n.okBy?.[from]) return;
        n.okBy = { ...n.okBy, [from]: ts };
        await this.saveNotices();
        this.emit('change');
        break;
      }
      case 'status': {
        // Only from people I know (a contact, someone in one of my groups, or an admin): no status spam.
        if (!this.knows(from) && Date.now() - this.lastGroupReload > 3000) await this.loadGroups().catch(() => {});
        if (!this.knows(from) || typeof p.id !== 'string' || !/^[0-9a-f]{32}$/.test(p.id)) return;
        if (typeof p.text !== 'string' || p.text.length > MAX_STATUS_TEXT) return;
        const photo = p.photo && validPointer(p.photo) && attachmentKind(p.photo.mime, p.photo.name) === 'image' ? p.photo : undefined;
        if (p.photo && !photo) return;
        const text = p.text.trim();
        if (!photo && !text) return;
        const bg = !photo && typeof p.bg === 'string' && STATUS_COLORS.includes(p.bg) ? p.bg : undefined;
        if (Date.now() - ts >= STATUS_TTL_MS) return; // waited in the queue for more than a day
        if (this.statuses.some((s) => s.id === p.id && s.from === from)) return;
        this.statuses.push({ id: p.id, from, ts, text, bg, photo, outgoing: false });
        await this.saveStatuses();
        this.emit('change');
        break;
      }
      case 'status-del': {
        const before = this.statuses.length;
        this.statuses = this.statuses.filter((s) => !(s.id === p.id && s.from === from && !s.outgoing));
        if (this.statuses.length === before) return;
        this.statusPhotos.delete(p.id);
        await this.saveStatuses();
        this.emit('change');
        break;
      }
      case 'status-seen': {
        const s = this.statuses.find((x) => x.outgoing && x.id === p.id);
        if (!s?.audience?.includes(from) || s.viewers?.[from]) return;
        s.viewers = { ...s.viewers, [from]: ts };
        await this.saveStatuses();
        this.emit('change');
        break;
      }
      case 'dk':
        if (typeof p.key === 'string' && p.key.length === 44) {
          const keys = await this.store.getSetting<Record<string, string>>('peerDeliveryKeys', {});
          keys[from] = p.key;
          await this.store.setSetting('peerDeliveryKeys', keys);
        }
        break;
      case 'call':
        this.addContactLocal(from);
        this.emit('callSignal', from, p);
        break;
      case 'gcall': {
        // Only from someone the server lists in that group.
        if (typeof p.callId !== 'string' || p.callId.length > 64) return;
        const key = await this.chatKeyFor(from, p.g);
        if (key) this.emit('groupCallSignal', from, p);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ sending

  private async sendPayload(peer: string, payload: Payload, msgId?: string): Promise<void> {
    await this.withLock(peer, async () => {
      if (!this.ws || this.ws.readyState !== 1) throw new Error('You are offline');
      if (!(await this.cipher.hasSession(peer))) {
        const bundle = await this.http<KeyBundleResponse>('GET', `/v1/keys/${encodeURIComponent(peer)}`);
        const status = await this.cipher.initOutgoing(peer, parseBundle(bundle));
        if (status === 'changed') this.onIdentityChanged(peer);
      }
      // Before the first real message to someone, give them our delivery key (inside the encryption).
      if (payload.k === 'text' || payload.k === 'poll' || payload.k === 'event') await this.shareDeliveryKey(peer);
      await this.sendWire(peer, payload, msgId);
    });
  }

  private async sendWire(peer: string, payload: Payload, msgId?: string): Promise<void> {
    const wire = await this.cipher.encrypt(peer, pad(JSON.stringify(payload)));
    const body = JSON.stringify(wire);
    const push: PushKind | undefined =
      payload.k === 'text' || payload.k === 'notice' || payload.k === 'poll' || payload.k === 'event'
        ? 'message'
        : (payload.k === 'call' && payload.action === 'offer') || (payload.k === 'gcall' && payload.action === 'invite') ? 'call' : undefined;
    if (await this.trySealedSend(peer, body, push)) {
      if (msgId) this.setMsgStatus(peer, msgId, 'sent');
      return;
    }
    const ref = newId();
    if (msgId) this.pendingSends.set(ref, { peer, msgId });
    this.sendFrame({ type: 'send', ref, to: peer, body, push });
  }

  // ------------------------------------------------------------------ sealed sender

  /**
   * The server announces its official address (e.g. after moving to a new domain). Switch to it, but only once the
   * new address proves to be this same server: it has the same certificate key and accepts my login. Never moves
   * from https to plain http.
   */
  private async followServerMove(): Promise<void> {
    const a = this.account;
    if (!a) return;
    const cfg = await this.http<PublicConfig>('GET', '/v1/config');
    if (!cfg.serverUrl || !cfg.certKey) return;
    const next = normalizeServerUrl(cfg.serverUrl);
    if (next === a.serverUrl || !/^https?:\/\/\S+$/i.test(next)) return;
    if (/^https:/i.test(a.serverUrl) && !/^https:/i.test(next)) return;
    const there = await this.fetchImpl(`${next}/v1/config`);
    if (!there.ok || ((await there.json()) as PublicConfig).certKey !== cfg.certKey) return;
    const me = await this.fetchImpl(`${next}/v1/me`, {
      headers: { authorization: 'Basic ' + toBase64(utf8(`${a.username}:${a.password}`)) },
    });
    if (!me.ok || this.account !== a) return;
    this.account = { ...a, serverUrl: next };
    await this.store.saveAccount(this.account);
    this.emit('change');
    this.ws?.close(); // reconnects on the new address
  }

  /** Load the server's certificate key (trust on first use), register my delivery key, fetch a certificate. */
  private async setupSealedSender(): Promise<void> {
    const a = this.account;
    if (!a) return;
    const saved = await this.store.getSetting<string | null>('certKey', null);
    if (saved) {
      this.certKey = fromBase64(saved);
    } else {
      const cfg = await this.http<PublicConfig>('GET', '/v1/config');
      if (!cfg.certKey) return; // older server without sealed sender
      await this.store.setSetting('certKey', cfg.certKey);
      this.certKey = fromBase64(cfg.certKey);
    }
    // One delivery key per device identity (a new login gets a new one).
    const me = toBase64(a.identity.pub);
    const dk = await this.store.getSetting<{ key: string; for: string; registered: boolean } | null>('deliveryKey', null);
    if (!dk || dk.for !== me || !dk.registered) {
      const key = dk?.for === me ? dk.key : newDeliveryKey();
      await this.http('PUT', '/v1/delivery-key', { hash: deliveryKeyHash(key) });
      await this.store.setSetting('deliveryKey', { key, for: me, registered: true });
    }
    await this.currentCertificate();
  }

  private async currentCertificate(): Promise<SenderCertificate | null> {
    if (!this.certKey) return null;
    if (this.certificate && this.certificate.exp - Date.now() > 3600_000) return this.certificate;
    const { certificate } = await this.http<{ certificate: SenderCertificate }>('GET', '/v1/certificate');
    if (!verifyCertificate(this.certKey, certificate) || certificate.u !== this.account?.username) {
      throw new Error('server sent an invalid sender certificate');
    }
    this.certificate = certificate;
    return certificate;
  }

  private async shareDeliveryKey(peer: string): Promise<void> {
    const dk = await this.store.getSetting<{ key: string } | null>('deliveryKey', null);
    if (!dk) return;
    const shared = await this.store.getSetting<Record<string, string>>('deliveryKeyShared', {});
    if (shared[peer] === dk.key) return;
    await this.sendWire(peer, { k: 'dk', key: dk.key });
    shared[peer] = dk.key;
    await this.store.setSetting('deliveryKeyShared', shared);
  }

  /**
   * Send without logging in, so the server can't tell who the sender is. Returns false when that's
   * not possible yet (no delivery key from this contact, no certificate); the caller then sends normally.
   */
  private async trySealedSend(peer: string, body: string, push?: PushKind): Promise<boolean> {
    const a = this.account;
    if (!a) return false;
    const keys = await this.store.getSetting<Record<string, string>>('peerDeliveryKeys', {});
    const theirKey = keys[peer];
    const theirIdentity = (await this.store.getIdentity(peer))?.key;
    if (!theirKey || !theirIdentity) return false;
    const cert = await this.currentCertificate().catch(() => null);
    if (!cert) return false;
    const headers: Record<string, string> = { 'content-type': 'text/plain', 'x-delivery-key': theirKey };
    if (push) headers['x-push'] = push;
    const res = await this.fetchImpl(`${a.serverUrl}/v1/sealed/${encodeURIComponent(peer)}`, {
      method: 'POST',
      headers,
      body: sealMessage(a.identity, cert, theirIdentity, body),
    });
    if (res.ok) return true;
    if (res.status === 401) {
      // Their key changed (new phone): forget it and send normally until they share the new one.
      delete keys[peer];
      await this.store.setSetting('peerDeliveryKeys', keys);
      return false;
    }
    throw new ApiError(res.status, (await res.text()) || res.statusText);
  }

  private async openSealed(body: string): Promise<{ from: string; body: string; identity: Uint8Array } | null> {
    const a = this.account;
    if (!a) return null;
    if (!this.certKey) {
      const saved = await this.store.getSetting<string | null>('certKey', null);
      if (saved) this.certKey = fromBase64(saved);
    }
    try {
      const opened = unsealMessage(a.identity, body);
      if (!this.certKey || !verifyCertificate(this.certKey, opened.cert) || !USERNAME_RE.test(opened.cert.u)) {
        throw new Error('sender certificate not valid');
      }
      return { from: opened.cert.u, body: opened.body, identity: opened.senderIdentityKey };
    } catch (e) {
      console.warn('sealed message rejected', e);
      return null;
    }
  }

  /** `replyTo`: the message this answers (quoted above it, like WhatsApp). */
  async sendText(peer: string, text: string, opts: { broadcast?: boolean; replyTo?: ChatMessage } = {}): Promise<void> {
    // In a group, "@name" / "@id" of a member mentions them.
    const members = isGroupKey(peer) ? (this.groupOf(peer)?.members ?? []).filter((u) => u !== this.account?.username) : [];
    const mentions = members.length ? findMentions(text, members, (u) => this.displayName(u)) : [];
    await this.sendMessage(peer, text, { broadcast: opts.broadcast, replyTo: opts.replyTo && this.quoteOf(opts.replyTo), mentions });
  }

  /** Send a photo / PDF / file / voice message (with an optional caption). */
  /** iewOnce: a photo / video they can open one time only (never saved, by them or by me). */
  async sendFile(peer: string, file: OutgoingFile, caption = '', opts: { replyTo?: ChatMessage; viewOnce?: boolean } = {}): Promise<void> {
    if (!this.can('sendFiles', peer)) throw new Error('Your admin has turned off sending photos and files');
    if (opts.viewOnce && !/^(image|video)\//.test(file.mime)) throw new Error('Only photos and videos can be view once');
    await this.sendMessage(peer, caption, { file, replyTo: opts.replyTo && this.quoteOf(opts.replyTo), viewOnce: opts.viewOnce });
  }

  /** Share a colleague's contact card; the other side can start a chat with them in one tap. */
  async sendContact(peer: string, username: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username) || !(await this.userExists(username))) throw new Error('User not found');
    await this.sendMessage(peer, '', { contact: username });
  }

  /** Share a location pin (from the device's GPS, or typed in). */
  async sendLocation(peer: string, location: SharedLocation): Promise<void> {
    const loc = cleanLocation(location);
    if (!loc) throw new Error('Invalid location');
    await this.sendMessage(peer, '', { location: loc });
  }

  /** Share a catalog product into a chat (as a card with name, price and description). */
  async sendProduct(peer: string, product: ProductCard, caption = ''): Promise<void> {
    const card = cleanProduct(product);
    if (!card) throw new Error('Invalid product');
    await this.sendMessage(peer, caption, { product: card });
  }

  /**
   * Forward a message to another chat, freshly encrypted for it and marked "Forwarded". Text, files, voice
   * messages, locations, contacts and products can be forwarded; polls and events can't (like WhatsApp).
   */
  async forwardMessage(to: string, m: ChatMessage): Promise<void> {
    if (m.deleted || m.system || m.call || m.poll || m.event) throw new Error("This message can't be forwarded");
    if (!this.can('forward', m.peer)) throw new Error('Your admin has turned off forwarding');
    if (m.attachment && !this.can('sendFiles', to)) throw new Error('Your admin has turned off sending files there');
    if (m.attachment && !m.attachment.data) throw new Error('The file is not available');
    const a = m.attachment;
    await this.sendMessage(to, m.text, {
      file: a && { name: a.name, mime: a.mime, data: a.data! },
      contact: m.contact,
      location: m.location,
      product: m.product,
      forwarded: true,
    });
  }

  /** React to a message with one of REACTIONS, or null to remove my reaction. Everyone in the chat sees it. */
  async react(chat: string, msgId: string, emoji: string | null): Promise<void> {
    const e = emoji ?? '';
    if (e && !(REACTIONS as readonly string[]).includes(e)) throw new Error('Unknown reaction');
    const m = this.chats.get(chat)?.find((x) => x.id === msgId && !x.deleted && !x.system);
    if (!m) throw new Error('Message not found');
    const me = this.account!.username;
    const before = m.reactions?.[me];
    const set = (v: string | undefined) => {
      m.reactions = { ...m.reactions };
      if (v) m.reactions[me] = v;
      else delete m.reactions[me];
      this.emit('change');
    };
    set(e || undefined);
    try {
      await this.sendToChat(chat, { k: 'react', id: msgId, e });
    } catch (err) {
      set(before);
      throw err;
    }
  }

  /** Snapshot of a message for a reply: who wrote it and a short preview. */
  private quoteOf(m: ChatMessage): Quote {
    const from = m.outgoing ? this.account!.username : (m.from ?? m.peer);
    return { id: m.id, from, text: MessengerClient.preview(m).slice(0, MAX_QUOTE) };
  }

  private async sendMessage(
    peer: string,
    text: string,
    opts: {
      broadcast?: boolean;
      file?: OutgoingFile;
      uploaded?: AttachmentPointer;
      replyTo?: Quote;
      contact?: string;
      location?: SharedLocation;
      product?: ProductCard;
      forwarded?: boolean;
      mentions?: string[];
      viewOnce?: boolean;
    },
  ): Promise<void> {
    text = text.trim();
    if (!text && !opts.file && !opts.contact && !opts.location && !opts.product) return;
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Message too long');
    if (opts.file) checkFile(opts.file);
    const group = isGroupKey(peer);
    if (group && !this.groupOf(peer)) throw new Error('You are not in this group any more');
    if (group && !this.canSendTo(peer)) throw new Error('Only selected members can send messages in this group');
    const expire = group ? 0 : this.getDisappearingTimer(peer);
    const msg: ChatMessage = {
      id: newId(),
      peer,
      text,
      ts: Date.now(),
      outgoing: true,
      status: 'sending',
      expiresAt: expire ? Date.now() + expire * 1000 : undefined,
      broadcast: opts.broadcast || undefined,
      replyTo: opts.replyTo,
      contact: opts.contact,
      location: opts.location,
      product: opts.product,
      forwarded: opts.forwarded || undefined,
      mentions: opts.mentions?.length ? opts.mentions : undefined,
      viewOnce: opts.viewOnce || undefined,
    };
    if (opts.file) {
      const name = safeFileName(opts.file.name);
      msg.attachment = {
        name,
        mime: opts.file.mime,
        size: opts.file.data.length,
        kind: attachmentKind(opts.file.mime, name),
        state: 'uploading',
        data: opts.file.data,
      };
    }
    if (!group) this.addContactLocal(peer);
    this.chatOf(peer).push(msg);
    this.emit('change');
    try {
      let att: AttachmentPointer | undefined;
      if (opts.file) {
        att = opts.uploaded ?? (await this.uploadAttachment(opts.file));
        msg.attachment!.state = 'ready';
        if (opts.viewOnce) {
          // View once: I don't keep it either.
          msg.attachment!.data = undefined;
        } else {
          msg.attachment!.ptr = att;
          void this.keepMedia(msg, opts.file.data);
        }
      }
      const payload: Payload = {
        k: 'text',
        id: msg.id,
        text,
        ts: msg.ts,
        expire: expire || undefined,
        bc: opts.broadcast || undefined,
        att,
        re: opts.replyTo,
        contact: opts.contact,
        loc: opts.location,
        product: opts.product,
        fwd: opts.forwarded || undefined,
        mn: opts.mentions?.length ? opts.mentions : undefined,
        vo: opts.viewOnce || undefined,
      };
      if (group) {
        const r = await this.sendToChat(peer, payload);
        // Failures for single members (e.g. not logged in yet) don't fail the whole message.
        if (r.total && !r.sent) throw new Error('Could not send to any group member');
        msg.status = 'sent';
        this.emit('change');
      } else {
        await this.sendPayload(peer, payload, msg.id);
      }
    } catch (e) {
      msg.status = 'failed';
      if (msg.attachment && msg.attachment.state === 'uploading') msg.attachment.state = 'failed';
      this.emit('change');
      throw e;
    }
  }

  /** Send a poll to a chat. `multi` = people may pick more than one option. */
  async sendPoll(peer: string, question: string, options: string[], multi = false): Promise<void> {
    const poll = cleanPoll(question, options, multi);
    if (!poll) {
      throw new Error(
        `A poll needs a question (max ${MAX_POLL_QUESTION} characters) and 2-${MAX_POLL_OPTIONS} different options (max ${MAX_POLL_OPTION} characters each)`,
      );
    }
    await this.sendStructured(peer, { poll }, (base) => ({ k: 'poll', ...base, q: poll.question, opts: poll.options, multi: poll.multi || undefined }));
  }

  /** Send an event invitation to a chat. */
  async sendEvent(peer: string, e: NewEvent): Promise<void> {
    const event = cleanEvent({ title: e.title, desc: e.description, start: e.start, end: e.end, place: e.place });
    if (!event) throw new Error('An event needs a title, a start time, and an end after the start');
    await this.sendStructured(peer, { event }, (base) => ({
      k: 'event',
      ...base,
      title: event.title,
      desc: event.description,
      start: event.start,
      end: event.end,
      place: event.place,
    }));
  }

  /** Like sendMessage, for polls and events. */
  private async sendStructured(
    peer: string,
    content: { poll: Poll } | { event: ChatEvent },
    payloadOf: (base: { id: string; ts: number; expire?: number }) => Payload,
  ): Promise<void> {
    const group = isGroupKey(peer);
    if (group && !this.groupOf(peer)) throw new Error('You are not in this group any more');
    if (group && !this.canSendTo(peer)) throw new Error('Only selected members can send messages in this group');
    const expire = group ? 0 : this.getDisappearingTimer(peer);
    const msg: ChatMessage = {
      id: newId(),
      peer,
      text: '',
      ts: Date.now(),
      outgoing: true,
      status: 'sending',
      expiresAt: expire ? Date.now() + expire * 1000 : undefined,
      ...content,
    };
    if (!group) this.addContactLocal(peer);
    this.chatOf(peer).push(msg);
    this.emit('change');
    try {
      const payload = payloadOf({ id: msg.id, ts: msg.ts, expire: expire || undefined });
      if (group) {
        const r = await this.sendToChat(peer, payload);
        if (r.total && !r.sent) throw new Error('Could not send to any group member');
        msg.status = 'sent';
        this.emit('change');
      } else {
        await this.sendPayload(peer, payload, msg.id);
      }
    } catch (e) {
      msg.status = 'failed';
      this.emit('change');
      throw e;
    }
  }

  /** Vote on a poll (option indexes; [] takes my vote back). Everyone in the chat sees it. */
  async votePoll(chat: string, msgId: string, choices: number[]): Promise<void> {
    const m = this.chats.get(chat)?.find((x) => x.id === msgId && !x.deleted);
    if (!m?.poll) throw new Error('Poll not found');
    if (!validVote(m.poll, choices)) throw new Error(m.poll.multi ? 'Invalid choice' : 'Pick one option');
    const me = this.account!.username;
    const before = m.poll.votes[me];
    m.poll.votes = { ...m.poll.votes, [me]: choices };
    if (!choices.length) delete m.poll.votes[me];
    this.emit('change');
    try {
      await this.sendToChat(chat, { k: 'vote', id: msgId, ch: choices });
    } catch (e) {
      m.poll.votes = { ...m.poll.votes };
      if (before) m.poll.votes[me] = before;
      else delete m.poll.votes[me];
      this.emit('change');
      throw e;
    }
  }

  /** Answer an event invitation. Everyone in the chat sees it. */
  async rsvpEvent(chat: string, msgId: string, r: Rsvp): Promise<void> {
    const m = this.chats.get(chat)?.find((x) => x.id === msgId && !x.deleted);
    if (!m?.event) throw new Error('Event not found');
    const me = this.account!.username;
    const before = m.event.rsvp[me];
    m.event.rsvp = { ...m.event.rsvp, [me]: r };
    this.emit('change');
    try {
      await this.sendToChat(chat, { k: 'rsvp', id: msgId, r });
    } catch (e) {
      m.event.rsvp = { ...m.event.rsvp };
      if (before) m.event.rsvp[me] = before;
      else delete m.event.rsvp[me];
      this.emit('change');
      throw e;
    }
  }

  /** Encrypt locally, upload only ciphertext. Returns the pointer that goes inside the E2E message. */
  private async uploadAttachment(file: OutgoingFile): Promise<AttachmentPointer> {
    const { ciphertext, key, digest } = encryptAttachment(file.data);
    const { id } = await this.http<{ id: string }>('POST', '/v1/attachments', toBase64(ciphertext), 'text/plain');
    return {
      id,
      key: toBase64(key),
      digest: toBase64(digest),
      name: safeFileName(file.name),
      mime: /^[\w.+-]{1,64}\/[\w.+-]{1,100}$/.test(file.mime) ? file.mime : 'application/octet-stream',
      size: file.data.length,
    };
  }

  /** Download + decrypt into memory. Nothing is ever written to disk. */
  private async fetchAttachment(msg: ChatMessage, p: AttachmentPointer) {
    try {
      const b64 = await this.http<string>('GET', `/v1/attachments/${p.id}`, undefined, undefined, true);
      const data = decryptAttachment(fromBase64(b64.trim()), fromBase64(p.key), fromBase64(p.digest));
      if (data.length !== p.size) throw new Error('size mismatch');
      if (msg.attachment) {
        msg.attachment.data = data;
        msg.attachment.state = 'ready';
        await this.keepMedia(msg, data);
      }
    } catch (e) {
      console.warn('attachment download failed', e);
      if (msg.attachment) msg.attachment.state = 'failed';
    }
    this.emit('change');
  }

  /** Admin only: every account incl. employees who haven't logged in yet (the server refuses non-admins). */
  async listAllUsers(): Promise<AdminUser[]> {
    const { users } = await this.http<{ users: AdminUser[] }>('GET', '/v1/admin/users');
    for (const u of users) this.noteAvatar(u.username, u.avatar);
    return users;
  }

  /**
   * Admin only: employees who can receive messages right now (logged in at least once).
   * With `departments`, only people in at least one of them.
   */
  async listActiveRecipients(departments?: string[]): Promise<string[]> {
    const only = departments?.length ? new Set(departments) : null;
    return (await this.listAllUsers())
      .filter((u) => u.active && !u.banned && u.username !== this.account?.username)
      .filter((u) => !only || u.departments.some((d) => only.has(d)))
      .map((u) => u.username);
  }

  /**
   * Admin only: send an announcement to every employee, or only to `departments`. Each copy is encrypted
   * separately with that person's own Double Ratchet session, so the server still cannot read it.
   * Replies arrive as normal 1:1 chats.
   */
  async broadcast(text: string, file?: OutgoingFile, opts: { departments?: string[] } = {}): Promise<BroadcastResult> {
    if (!this.isAdmin) throw new Error('Only admins can send announcements');
    if (!text.trim() && !file) throw new Error('Message is empty');
    if (file) checkFile(file);
    const users = await this.listActiveRecipients(opts.departments);
    if (opts.departments?.length && !users.length) throw new Error('Nobody in those departments can receive messages yet');
    // Upload the encrypted file once; every employee gets the key inside their own encrypted message.
    const uploaded = file ? await this.uploadAttachment(file) : undefined;
    const results = await Promise.allSettled(
      users.map((u) => this.sendMessage(u, text, { broadcast: true, file, uploaded })),
    );
    const failed = users.filter((_, i) => results[i]!.status === 'rejected');
    return { sent: users.length - failed.length, failed };
  }

  // ------------------------------------------------------------------ notices

  /**
   * Admin only: send a notice to everyone, or to people in the chosen departments and/or groups. It pops up on
   * their screen until they click OK; their OK comes back here (see Notice.okBy). Each copy is end-to-end
   * encrypted separately, like announcements.
   */
  async sendNotice(title: string, text: string, target: NoticeTarget = {}): Promise<BroadcastResult> {
    if (!this.isAdmin) throw new Error('Only admins can send notices');
    title = title.trim();
    text = text.trim();
    if (!title && !text) throw new Error('Notice is empty');
    if (title.length > MAX_NOTICE_TITLE) throw new Error(`Title too long (max ${MAX_NOTICE_TITLE} characters)`);
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Notice too long');
    const [users, groups] = await Promise.all([
      this.listAllUsers(),
      target.groups?.length ? this.listAllGroups() : Promise.resolve([]),
    ]);
    const to = noticeAudience(users, groups, target, this.account?.username);
    const picked = !!(target.departments?.length || target.groups?.length);
    if (!to.length) throw new Error(picked ? 'Nobody in those departments or groups can receive notices yet' : 'Nobody can receive notices yet');
    const groupNames = groups.filter((g) => target.groups?.includes(g.id)).map((g) => g.name);
    const notice: Notice = {
      id: newId(),
      from: this.account!.username,
      title,
      text,
      ts: Date.now(),
      outgoing: true,
      audience: picked ? [...(target.departments ?? []), ...groupNames].join(', ') : 'Everyone',
      okBy: {},
    };
    const payload: Payload = { k: 'notice', id: notice.id, title, text, ts: notice.ts };
    const results = await Promise.allSettled(to.map((u) => this.sendPayload(u, payload)));
    const failed = to.filter((_, i) => results[i]!.status === 'rejected');
    notice.recipients = to.filter((u) => !failed.includes(u));
    if (notice.recipients.length) {
      this.notices.push(notice);
      await this.saveNotices();
      this.emit('change');
    }
    return { sent: notice.recipients.length, failed };
  }

  /** Every notice I received or sent, newest first. */
  getNotices(): Notice[] {
    return [...this.notices].sort((a, b) => b.ts - a.ts);
  }

  /** Received notices I haven't clicked OK on yet, oldest first (the app shows them one after another). */
  pendingNotices(): Notice[] {
    return this.notices.filter((n) => !n.outgoing && !n.okAt).sort((a, b) => a.ts - b.ts);
  }

  /** "OK" on a notice: it stops popping up and the admin who sent it sees that I read it. */
  async acknowledgeNotice(id: string): Promise<void> {
    const n = this.notices.find((x) => !x.outgoing && x.id === id);
    if (!n || n.okAt) return;
    n.okAt = Date.now();
    await this.saveNotices();
    this.emit('change');
    await this.sendNoticeOks();
  }

  /** Tell admins about OKs they haven't heard about yet (e.g. clicked while offline). */
  private async sendNoticeOks(): Promise<void> {
    const unsent = this.notices.filter((n) => !n.outgoing && n.okAt && !n.okSent);
    if (!unsent.length || this.ws?.readyState !== 1) return;
    let changed = false;
    for (const n of unsent) {
      try {
        await this.sendPayload(n.from, { k: 'notice-ok', id: n.id });
        n.okSent = true;
        changed = true;
      } catch (e) {
        console.warn('notice OK not sent', e);
      }
    }
    if (changed) await this.saveNotices();
  }

  private async saveNotices(): Promise<void> {
    if (this.notices.length > MAX_NOTICES) {
      // Keep the newest ones, but never drop one that still has to be clicked OK.
      const keep = new Set(this.getNotices().slice(0, MAX_NOTICES));
      this.notices = this.notices.filter((n) => keep.has(n) || (!n.outgoing && !n.okAt));
    }
    await this.store.setSetting('notices', this.notices);
  }

  // ------------------------------------------------------------------ status

  /** Someone I have a chat with, share a group with, or an admin. */
  private knows(user: string): boolean {
    return this.contacts.includes(user) || this.admins.includes(user) || this.groups.some((g) => g.members.includes(user));
  }

  /** Who sees my status: my contacts and everyone in my groups (like WhatsApp's "My contacts"). */
  statusAudience(): string[] {
    const me = this.account?.username;
    return [...new Set([...this.contacts, ...this.groups.flatMap((g) => g.members)])].filter((u) => u !== me).sort();
  }

  /**
   * Post a status: text on a colour, or a photo with an optional caption. Each viewer gets their own
   * end-to-end encrypted copy (a photo is uploaded once, encrypted; its key travels only inside those copies).
   */
  async postStatus(s: NewStatus): Promise<BroadcastResult> {
    if (!this.can('postStatus')) throw new Error('Your admin has turned off posting status updates');
    const text = ('photo' in s ? (s.caption ?? '') : s.text).trim();
    if (text.length > MAX_STATUS_TEXT) throw new Error(`Status too long (max ${MAX_STATUS_TEXT} characters)`);
    if (!('photo' in s) && !text) throw new Error('Status is empty');
    if ('photo' in s) {
      checkFile(s.photo);
      if (attachmentKind(s.photo.mime, s.photo.name) !== 'image') throw new Error('A status photo must be an image');
    }
    const bg = 'photo' in s ? undefined : STATUS_COLORS.includes(s.bg ?? '') ? s.bg : STATUS_COLORS[0];
    const to = this.statusAudience();
    if (!to.length) throw new Error('Nobody to show it to yet: start a chat first');
    if (this.status !== 'online') throw new Error('You are offline');
    const photo = 'photo' in s ? await this.uploadAttachment(s.photo) : undefined;
    const status: StatusUpdate = { id: newId(), from: this.account!.username, ts: Date.now(), text, bg, photo, outgoing: true, viewers: {} };
    const payload: Payload = { k: 'status', id: status.id, text, bg, photo, ts: status.ts };
    const results = await Promise.allSettled(to.map((u) => this.sendPayload(u, payload)));
    const failed = to.filter((_, i) => results[i]!.status === 'rejected');
    status.audience = to.filter((u) => !failed.includes(u));
    if (!status.audience.length) throw new Error('Could not send the status to anyone');
    if ('photo' in s) this.statusPhotos.set(status.id, Promise.resolve(s.photo.data));
    this.statuses.push(status);
    await this.saveStatuses();
    this.emit('change');
    return { sent: status.audience.length, failed };
  }

  /** Delete one of my statuses, here and on everyone's phone. */
  async deleteStatus(id: string): Promise<void> {
    const s = this.statuses.find((x) => x.outgoing && x.id === id);
    if (!s) return;
    await Promise.allSettled((s.audience ?? []).map((u) => this.sendPayload(u, { k: 'status-del', id })));
    this.statuses = this.statuses.filter((x) => x !== s);
    this.statusPhotos.delete(id);
    await this.saveStatuses();
    this.emit('change');
  }

  /** My current statuses, oldest first. */
  myStatuses(): StatusUpdate[] {
    return this.statuses.filter((s) => s.outgoing).sort((a, b) => a.ts - b.ts);
  }

  /** Other people's current statuses, by person: ones with unviewed updates first, then newest first. */
  statusGroups(): StatusGroup[] {
    const by = new Map<string, StatusUpdate[]>();
    for (const s of this.statuses) if (!s.outgoing) by.set(s.from, [...(by.get(s.from) ?? []), s]);
    return [...by]
      .map(([user, list]) => {
        const items = list.sort((a, b) => a.ts - b.ts);
        return { user, items, allSeen: items.every((s) => s.seen), latest: items[items.length - 1]!.ts };
      })
      .sort((a, b) => Number(a.allSeen) - Number(b.allSeen) || b.latest - a.latest);
  }

  /** How many people have status updates I haven't viewed yet. */
  get unseenStatusCount(): number {
    return this.statusGroups().filter((g) => !g.allSeen).length;
  }

  /** I viewed a status: remember it, and tell the poster (they see who viewed it). */
  markStatusSeen(id: string, from: string): void {
    const s = this.statuses.find((x) => !x.outgoing && x.id === id && x.from === from);
    if (!s || s.seen) return;
    s.seen = true;
    void this.saveStatuses();
    this.emit('change');
    this.sendPayload(from, { k: 'status-seen', id }).catch(() => {});
  }

  /** A status photo, downloaded and decrypted into memory (once per status). */
  statusPhoto(s: StatusUpdate): Promise<Uint8Array> {
    if (!s.photo) return Promise.reject(new Error('This status has no photo'));
    let p = this.statusPhotos.get(s.id);
    if (!p) {
      const ptr = s.photo;
      p = this.http<string>('GET', `/v1/attachments/${ptr.id}`, undefined, undefined, true).then((b64) => {
        const data = decryptAttachment(fromBase64(b64.trim()), fromBase64(ptr.key), fromBase64(ptr.digest));
        if (data.length !== ptr.size) throw new Error('size mismatch');
        return data;
      });
      p.catch(() => this.statusPhotos.delete(s.id));
      this.statusPhotos.set(s.id, p);
    }
    return p;
  }

  /** Drop statuses older than 24 hours. */
  private expireStatuses(now: number): boolean {
    const kept = this.statuses.filter((s) => now - s.ts < STATUS_TTL_MS);
    if (kept.length === this.statuses.length) return false;
    for (const s of this.statuses) if (!kept.includes(s)) this.statusPhotos.delete(s.id);
    this.statuses = kept;
    void this.saveStatuses();
    return true;
  }

  private saveStatuses() {
    return this.store.setSetting('statuses', this.statuses);
  }

  sendCallSignal(peer: string, signal: CallSignal | GroupCallSignal): Promise<void> {
    return this.sendPayload(peer, signal);
  }

  // ------------------------------------------------------------------ groups

  groupOf(key: string): GroupInfo | undefined {
    return isGroupKey(key) ? this.groups.find((g) => g.id === groupIdOf(key)) : undefined;
  }

  /** Whether `user` may send in this group: every member, or only the chosen senders (admins always). */
  maySendInGroup(key: string, user: string): boolean {
    const g = this.groupOf(key);
    if (!g || !g.members.includes(user)) return false;
    return g.senders === null || g.senders === undefined || g.senders.includes(user) || this.admins.includes(user);
  }

  /** Whether I can write in this chat (false in a group where the admin chose other senders). */
  canSendTo(key: string): boolean {
    return !isGroupKey(key) || (!!this.account && this.maySendInGroup(key, this.account.username));
  }

  /** Receiving side of maySendInGroup; reloads the group once if our copy may be stale. */
  private async mayPost(key: string, from: string): Promise<boolean> {
    if (this.maySendInGroup(key, from)) return true;
    if (Date.now() - this.lastGroupReload > 3000) await this.loadGroups().catch(() => {});
    return this.maySendInGroup(key, from);
  }

  /** A group's members for its member list: me first, then admins, then who's online, then A-Z. */
  groupMembers(key: string): string[] {
    const me = this.account?.username;
    const rank = (u: string) => (u === me ? 0 : this.admins.includes(u) ? 1 : this.presence.get(u)?.online ? 2 : 3);
    return [...(this.groupOf(key)?.members ?? [])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  /** Under a group's name, like WhatsApp: "asha, bina, ravi, You". */
  groupMemberLine(key: string): string {
    const me = this.account?.username;
    const members = this.groupOf(key)?.members ?? [];
    const others = members.filter((u) => u !== me).sort((a, b) => a.localeCompare(b));
    return [...others, ...(me && members.includes(me) ? ['You'] : [])].join(', ');
  }

  /** Display name of a chat: the person's full name (their ID until it is known / if none), or the group's name. */
  chatTitle(key: string): string {
    if (isGroupKey(key)) return this.groupOf(key)?.name ?? 'Removed group';
    return this.displayName(key);
  }

  /** A person's full name as the admin entered it, or their ID. */
  displayName(username: string): string {
    return this.profileOf(username)?.name || shortId(username);
  }

  /** Everything for the chat list: my groups first, then 1:1 contacts. */
  chatKeys(): string[] {
    return [...this.groups.map((g) => groupKey(g.id)), ...this.contacts];
  }

  async loadGroups(): Promise<void> {
    this.lastGroupReload = Date.now();
    const { groups } = await this.http<{ groups: GroupInfo[] }>('GET', '/v1/groups');
    this.groups = groups;
    this.emit('change');
  }

  /**
   * Send a payload into a chat. In a group, every other member gets their own end-to-end encrypted
   * copy (tagged with the group id), so the server never sees group content either.
   */
  private async sendToChat(key: string, payload: Payload, onlyWithSession = false): Promise<{ sent: number; total: number }> {
    if (!isGroupKey(key)) {
      await this.sendPayload(key, payload);
      return { sent: 1, total: 1 };
    }
    const group = this.groupOf(key);
    if (!group) throw new Error('You are not in this group any more');
    let members = group.members.filter((u) => u !== this.account?.username);
    if (onlyWithSession) {
      const has = await Promise.all(members.map((u) => this.cipher.hasSession(u)));
      members = members.filter((_, i) => has[i]);
    }
    const tagged = { ...payload, g: group.id } as Payload;
    const results = await Promise.allSettled(members.map((u) => this.sendPayload(u, tagged)));
    return { sent: results.filter((r) => r.status === 'fulfilled').length, total: members.length };
  }

  // ------------------------------------------------------------------ edit / delete / typing

  /** Whether I may edit and delete-for-everyone my messages (admins always; others if the admin allows it). */
  get canEditDelete(): boolean {
    return this.can('editDelete', this.activeChat);
  }

  async editMessage(key: string, id: string, text: string): Promise<void> {
    if (!this.canEditDelete) throw new Error('Your admin has turned off editing messages');
    text = text.trim();
    if (!text) throw new Error('Message is empty');
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Message too long');
    const m = this.chats.get(key)?.find((x) => x.id === id && x.outgoing && !x.deleted);
    if (!m) throw new Error('Message not found');
    if (m.poll || m.event) throw new Error("Polls and events can't be edited");
    if (m.text === text) return;
    await this.sendToChat(key, { k: 'edit', id, text });
    m.text = text;
    m.edited = true;
    this.emit('change');
  }

  /**
   * Delete a message. For everyone: my own messages (if allowed), or any message for admins. Otherwise it is
   * only removed from this device's memory.
   */
  async deleteMessage(key: string, id: string, forEveryone: boolean): Promise<void> {
    const list = this.chats.get(key);
    const m = list?.find((x) => x.id === id);
    if (!list || !m) return;
    if (!forEveryone) {
      if (!this.canClearHistory) throw new Error('Your admin has turned off deleting messages');
      this.wipe(m);
      this.forgetMedia(key, m.id);
      this.unstar(key, m.id);
      this.chats.set(key, list.filter((x) => x !== m));
      this.emit('change');
      return;
    }
    if (!this.canEditDelete) throw new Error('Your admin has turned off deleting messages for everyone');
    if (!m.outgoing && !this.isAdmin) throw new Error('You can only delete your own messages for everyone');
    await this.sendToChat(key, { k: 'del', id });
    this.markDeleted(m);
  }

  /** Call while the user types; sends "typing…" at most every few seconds, only to existing sessions. */
  notifyTyping(key: string): void {
    if (this.status !== 'online') return;
    const now = Date.now();
    if (now - (this.lastTypingSent.get(key) ?? 0) < TYPING_SEND_EVERY_MS) return;
    const group = this.groupOf(key);
    if (isGroupKey(key) && (!group || group.members.length > MAX_TYPING_FANOUT)) return;
    this.lastTypingSent.set(key, now);
    void (async () => {
      if (!isGroupKey(key) && !(await this.cipher.hasSession(key))) return;
      await this.sendToChat(key, { k: 'typing', on: true }, true);
    })().catch(() => {});
  }

  /** Who is typing in this chat right now. */
  getTyping(key: string): string[] {
    const now = Date.now();
    return [...(this.typing.get(key) ?? [])].filter(([, until]) => until > now).map(([u]) => u);
  }

  private clearTyping(key: string, user: string) {
    if (this.typing.get(key)?.delete(user)) this.emit('change');
  }

  private wipe(m: ChatMessage) {
    m.text = '';
    m.attachment?.data?.fill(0);
    if (m.attachment) m.attachment.data = undefined;
  }

  private markDeleted(m: ChatMessage) {
    this.wipe(m);
    this.forgetMedia(m.peer, m.id);
    this.unstar(m.peer, m.id);
    m.poll = undefined;
    m.event = undefined;
    m.contact = undefined;
    m.location = undefined;
    m.product = undefined;
    m.replyTo = undefined;
    m.reactions = undefined;
    m.attachment = undefined;
    m.deleted = true;
    m.edited = undefined;
    this.emit('change');
  }

  // ------------------------------------------------------------------ presence

  getPresence(user: string): Presence | undefined {
    return this.presence.get(user);
  }

  /** Online / last seen for my contacts and group members. */
  async refreshPresence(extra: string[] = []): Promise<void> {
    const me = this.account?.username;
    const names = [...new Set([...this.contacts, ...this.groups.flatMap((g) => g.members), ...extra])]
      .filter((u) => u !== me && USERNAME_RE.test(u))
      .slice(0, 200);
    if (!names.length || this.status !== 'online') return;
    try {
      const res = await this.http<Record<string, Presence>>('GET', `/v1/presence?u=${names.join(',')}`);
      for (const [u, p] of Object.entries(res)) {
        this.presence.set(u, p);
        this.noteAvatar(u, p.avatar ?? null);
      }
      this.emit('change');
    } catch (e) {
      console.warn('presence failed', e);
    }
  }

  // ------------------------------------------------------------------ profile photos

  /** A user's profile photo as a data: URL, or undefined (show their initial instead). */
  avatarOf(user: string): string | undefined {
    return this.avatars.get(user)?.url;
  }

  /**
   * Set my profile photo (JPEG / PNG / WebP, up to 2 MB; apps should shrink it first).
   * Everyone signed in to the server can see it - unlike messages it is not end-to-end encrypted.
   */
  async setMyAvatar(photo: { mime: string; data: Uint8Array }): Promise<void> {
    if (!(AVATAR_MIMES as readonly string[]).includes(photo.mime)) throw new Error('Photo must be JPEG, PNG or WebP');
    if (photo.data.length > MAX_AVATAR_BYTES) throw new Error('Photo too large (max 2 MB)');
    const data = toBase64(photo.data);
    const { ver } = await this.http<{ ver: number }>('PUT', '/v1/avatar', { mime: photo.mime, data });
    this.avatars.set(this.account!.username, { ver, url: `data:${photo.mime};base64,${data}` });
    this.emit('change');
  }

  async removeMyAvatar(): Promise<void> {
    await this.http('DELETE', '/v1/avatar');
    this.avatars.delete(this.account!.username);
    this.emit('change');
  }

  /** Server says user's photo is at version `ver` (null = none): fetch it once if we don't have that version. */
  private noteAvatar(user: string, ver: number | null) {
    if (ver === null) {
      if (this.avatars.delete(user)) this.emit('change');
      return;
    }
    if (this.avatars.get(user)?.ver === ver || this.avatarLoading.get(user) === ver) return;
    this.avatarLoading.set(user, ver);
    this.http<AvatarResponse>('GET', `/v1/avatars/${encodeURIComponent(user)}`)
      .then((a) => {
        if (!(AVATAR_MIMES as readonly string[]).includes(a.mime)) return;
        this.avatars.set(user, { ver: a.ver, url: `data:${a.mime};base64,${a.data}` });
        this.emit('change');
      })
      .catch(() => {})
      .finally(() => this.avatarLoading.delete(user));
  }

  /** Mobile calls this when the OS reports a screenshot (iOS can detect but not block it). */
  notifyScreenshot(peer: string): void {
    this.addSystem(peer, 'You took a screenshot.');
    this.sendPayload(peer, { k: 'screenshot' }).catch(() => {});
  }

  async setDisappearingTimer(peer: string, seconds: number): Promise<void> {
    if (seconds > 0 && !this.canClearHistory) throw new Error('Your admin has turned off disappearing messages');
    await this.applyTimer(peer, seconds, null);
    await this.sendPayload(peer, { k: 'timer', expire: seconds });
  }

  /**
   * The timer in effect: with history protection on (admin setting), only chats with an admin can disappear,
   * so a timer set before the admin turned it off no longer deletes anything.
   */
  getDisappearingTimer(peer: string): number {
    return this.canClearHistory || this.admins.includes(peer) ? (this.timers[peer] ?? 0) : 0;
  }

  private async applyTimer(peer: string, seconds: number, by: string | null) {
    if (seconds) this.timers[peer] = seconds;
    else delete this.timers[peer];
    await this.store.setSetting('timers', this.timers);
    const who = by ?? 'You';
    this.addSystem(
      peer,
      seconds ? `${who} set disappearing messages to ${formatDuration(seconds)}.` : `${who} turned off disappearing messages.`,
    );
  }

  // ------------------------------------------------------------------ chats & contacts

  getMessages(peer: string): ChatMessage[] {
    return this.chats.get(peer) ?? [];
  }

  getUnread(peer: string): number {
    return this.unread.get(peer) ?? 0;
  }

  /** Short text for chat lists / notifications. */
  static preview(m: ChatMessage): string {
    if (m.call) return callLogText(m.call);
    if (m.poll) return `📊 ${m.poll.question}`;
    if (m.event) return `📅 ${m.event.title}`;
    if (m.location) return `📍 ${m.location.name || 'Location'}`;
    if (m.contact) return `👤 ${m.contact}`;
    if (m.product) return `🛍️ ${m.product.name}`;
    if (m.attachment) {
      const label = { image: 'Photo', pdf: 'PDF', audio: '🎤 Voice message', file: 'File' }[m.attachment.kind];
      return m.text ? `${label}: ${m.text}` : label;
    }
    return m.text;
  }

  lastMessage(peer: string): ChatMessage | undefined {
    const c = this.chats.get(peer);
    return c?.[c.length - 1];
  }

  setActiveChat(peer: string | null): void {
    this.activeChat = peer;
    if (!peer) return;
    this.unread.delete(peer);
    const ids = this.getMessages(peer)
      .filter((m) => !m.outgoing && !m.system && m.receiptSent !== 'read')
      .map((m) => {
        m.receiptSent = 'read';
        return m.id;
      });
    // Read receipts off: they only see "delivered".
    if (ids.length && !isGroupKey(peer) && this.privacy.readReceipts) {
      this.sendPayload(peer, { k: 'receipt', ids, status: 'read' }).catch(() => {});
    }
    this.emit('change');
  }

  async userExists(username: string): Promise<boolean> {
    try {
      await this.http('GET', `/v1/users/${encodeURIComponent(username)}`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return false;
      throw e;
    }
  }

  /** Usernames starting with `prefix` (people you can message, not yourself), at most 20. */
  /**
   * Everyone in my company I can message, with their departments, sorted by name. Also fills the profile
   * cache, so names show everywhere at once.
   */
  async listDirectory(): Promise<UserProfile[]> {
    const { users } = await this.http<{ users: UserProfile[] }>('GET', '/v1/directory');
    const now = Date.now();
    for (const profile of users) this.profiles.set(profile.username, { profile, at: now, loading: false });
    this.emit('change');
    return users.sort((a, b) => (a.name || shortId(a.username)).localeCompare(b.name || shortId(b.username)));
  }

  async searchUsers(prefix: string): Promise<string[]> {
    const q = prefix.trim().toLowerCase();
    if (!q) return [];
    return (await this.http<{ users: string[] }>('GET', `/v1/users?q=${encodeURIComponent(q)}`)).users;
  }

  async addContact(username: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Invalid username');
    if (username === this.account?.username) throw new Error("That's you");
    if (!(await this.userExists(username))) throw new Error('User not found');
    this.addContactLocal(username);
  }

  private addContactLocal(username: string) {
    if (this.contacts.includes(username)) return;
    this.contacts = [...this.contacts, username];
    void this.store.saveContacts(this.contacts);
    this.emit('change');
  }

  async removeContact(username: string): Promise<void> {
    this.contacts = this.contacts.filter((c) => c !== username);
    // Without the right to clear history the messages stay; adding the contact again shows them.
    if (this.canClearHistory) {
      this.chats.delete(username);
      await this.media.remove((m) => m.chat === username);
    }
    this.unread.delete(username);
    await this.store.saveContacts(this.contacts);
    this.emit('change');
  }

  /** Whether I may remove chat history on this device (admins always; others if the admin allows it). */
  get canClearHistory(): boolean {
    return this.can('clearHistory', this.activeChat);
  }

  /** Clears the messages and the chat's saved photos and documents. */
  clearChat(peer: string): void {
    if (!this.canClearHistory) throw new Error('Your admin has turned off clearing chat history');
    this.chats.delete(peer);
    this.forgetMedia(peer);
    this.emit('change');
  }

  // ------------------------------------------------------------------ starred messages & search

  /**
   * Star / unstar a message. Starred messages are listed in Starred messages even after a restart (a short text
   * snapshot is kept encrypted on this device; files themselves are in Media and docs).
   */
  toggleStar(m: ChatMessage): void {
    if (m.system || m.deleted) return;
    if (m.starred) {
      this.unstar(m.peer, m.id);
      return;
    }
    m.starred = true;
    this.starred.push({
      chat: m.peer,
      msgId: m.id,
      from: m.outgoing ? this.account!.username : (m.from ?? m.peer),
      outgoing: m.outgoing,
      ts: m.ts,
      preview: MessengerClient.preview(m).slice(0, 1000),
    });
    void this.store.setSetting('starred', this.starred);
    this.emit('change');
  }

  /** Every starred message, newest first. */
  starredMessages(): StarredMessage[] {
    return [...this.starred].sort((a, b) => b.ts - a.ts);
  }

  private unstar(chat: string, msgId: string): void {
    const m = this.chats.get(chat)?.find((x) => x.id === msgId);
    if (m) m.starred = undefined;
    const before = this.starred.length;
    this.starred = this.starred.filter((s) => !(s.chat === chat && s.msgId === msgId));
    if (this.starred.length !== before) {
      void this.store.setSetting('starred', this.starred);
      this.emit('change');
    }
  }

  /** Messages in this chat containing `query` (text, captions, file names, poll / event / place names), newest first. */
  searchMessages(chat: string, query: string): ChatMessage[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.getMessages(chat)
      .filter((m) => !m.deleted && !m.system)
      .filter((m) =>
        [m.text, m.attachment?.name, MessengerClient.preview(m), m.poll?.options.join(' '), m.event?.place]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q)),
      )
      .reverse();
  }

  // ------------------------------------------------------------------ saved media (Media & docs)

  /** Photos and documents saved from this chat, newest first. They stay after the app restarts. */
  getMedia(chat: string): MediaItem[] {
    return this.media.list(chat);
  }

  /** Decrypt a saved file into memory, as an Attachment the apps' viewers can show. */
  async openMedia(item: MediaItem): Promise<Attachment> {
    const data = await this.media.read(item);
    return { name: item.name, mime: item.mime, size: item.size, kind: item.kind, state: 'ready', data };
  }

  /** Delete one saved file from this device (same rule as deleting a message for me). */
  async deleteMedia(item: MediaItem): Promise<void> {
    if (!this.canClearHistory) throw new Error('Your admin has turned off deleting files');
    await this.media.remove((m) => m.chat === item.chat && m.msgId === item.msgId);
    this.emit('change');
  }

  /**
   * Keep a sent or received file for the chat's Media & docs page. Not for disappearing messages: those must
   * vanish, so they are never written to the device. Never throws (the message itself already worked).
   */
  private async keepMedia(msg: ChatMessage, data: Uint8Array): Promise<void> {
    const a = msg.attachment;
    if (!a || msg.expiresAt || msg.deleted || msg.viewOnce) return;
    try {
      const added = await this.media.add(
        {
          msgId: msg.id,
          chat: msg.peer,
          from: msg.outgoing ? this.account!.username : (msg.from ?? msg.peer),
          outgoing: msg.outgoing,
          ts: msg.ts,
          name: a.name,
          mime: a.mime,
          size: data.length,
          kind: a.kind,
          caption: msg.text || undefined,
        },
        data,
      );
      if (!added) return;
      // Deleted (or the chat cleared) while it was being saved: take it back out.
      if (msg.deleted || !this.chats.get(msg.peer)?.includes(msg)) this.forgetMedia(msg.peer, msg.id);
      this.emit('change');
    } catch (e) {
      console.warn('could not save media', e);
    }
  }

  /** Remove a chat's saved media (one message's, or all of it). */
  private forgetMedia(chat: string, msgId?: string): void {
    this.media
      .remove((m) => m.chat === chat && (msgId === undefined || m.msgId === msgId))
      .then((n) => n && this.emit('change'))
      .catch((e) => console.warn('could not delete media', e));
  }

  /** Throw away sessions with a peer; the next message starts a fresh X3DH handshake. */
  async resetSession(peer: string): Promise<void> {
    await this.withLock(peer, () => this.store.deleteSessions(peer));
    this.addSystem(peer, 'Secure session reset.');
  }

  // ------------------------------------------------------------------ verification

  async getSafetyNumber(peer: string): Promise<{ number: string; verified: boolean } | null> {
    const their = await this.store.getIdentity(peer);
    if (!their || !this.account) return null;
    return {
      number: safetyNumber(this.account.username, this.account.identity.pub, peer, their.key),
      verified: their.verified,
    };
  }

  async setVerified(peer: string, verified: boolean): Promise<void> {
    const their = await this.store.getIdentity(peer);
    if (!their) return;
    await this.store.saveIdentity(peer, { ...their, verified });
    this.addSystem(peer, verified ? 'You marked this contact as verified.' : 'Verification cleared.');
  }

  private onIdentityChanged(peer: string) {
    this.addSystem(peer, `Your safety number with ${peer} changed. Verify it before sending anything sensitive.`);
    this.emit('identityChanged', peer);
  }

  // ------------------------------------------------------------------ calls / account

  getIceConfig(): Promise<IceConfigResponse> {
    return this.http<IceConfigResponse>('GET', '/v1/turn');
  }

  /** Self-deletion exists only on open servers without admins; on company servers an admin removes accounts. */
  get canDeleteOwnAccount(): boolean {
    return this.admins.length === 0;
  }

  async deleteAccount(): Promise<void> {
    if (!this.canDeleteOwnAccount) throw new Error('Only an admin can delete accounts. Ask your admin.');
    try {
      await this.http('DELETE', '/v1/account');
    } catch (e) {
      // Already gone on the server: still clean up here. Refused (e.g. 403): keep everything.
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 404))) throw e;
    }
    await this.wipeLocal();
  }

  /** Log out on this device: delete keys + in-memory chats. The account stays; log in again with ID + password. */
  async logout(): Promise<void> {
    // The newest chats go into the backup first, so signing in again (here or elsewhere) brings them back.
    await this.flushHistory().catch(() => {});
    await this.setPushToken(null).catch(() => {}); // stop pushes to this device (best effort)
    await this.wipeLocal();
  }

  // ------------------------------------------------------------------ chat list: pin, archive, mute

  chatPrefs: Record<string, ChatPrefs> = {};
  /** My privacy choices kept on this device. */
  privacy: { readReceipts: boolean } = { readReceipts: true };
  /** My "About" line and last-seen choice (on the server). */
  about = '';
  hideLastSeen = false;

  private setChatPref(key: string, patch: Partial<ChatPrefs>) {
    const next: ChatPrefs = { ...this.chatPrefs[key], ...patch };
    for (const k of Object.keys(next) as (keyof ChatPrefs)[]) if (next[k] === undefined || next[k] === false || next[k] === 0) delete next[k];
    if (Object.keys(next).length) this.chatPrefs[key] = next;
    else delete this.chatPrefs[key];
    void this.store.setSetting('chatPrefs', this.chatPrefs);
    this.emit('change');
  }

  isPinned = (key: string) => !!this.chatPrefs[key]?.pinned;
  isArchived = (key: string) => !!this.chatPrefs[key]?.archived;
  isMuted = (key: string) => (this.chatPrefs[key]?.muteUntil ?? 0) > Date.now();

  /** Pin to the top of the chat list (up to three, like WhatsApp). */
  pinChat(key: string, pin: boolean): void {
    if (pin && !this.isPinned(key) && Object.values(this.chatPrefs).filter((p) => p.pinned).length >= MAX_PINNED) {
      throw new Error(`You can pin up to ${MAX_PINNED} chats`);
    }
    this.setChatPref(key, { pinned: pin ? Date.now() : undefined, archived: pin ? undefined : this.chatPrefs[key]?.archived });
  }

  /** Archived chats leave the main list (they come back when a new message arrives, unless muted). */
  archiveChat(key: string, archive: boolean): void {
    this.setChatPref(key, { archived: archive || undefined, pinned: archive ? undefined : this.chatPrefs[key]?.pinned });
  }

  /** Mute for `ms` (Infinity = always); 0 unmutes. Muted chats show no unread highlight and don't come back from the archive. */
  muteChat(key: string, ms: number): void {
    this.setChatPref(key, { muteUntil: ms > 0 ? (Number.isFinite(ms) ? Date.now() + ms : Number.MAX_SAFE_INTEGER) : undefined });
  }

  /** The chat list: pinned first (last pinned on top), then by the newest message. */
  orderedChats(opts: { archived?: boolean } = {}): string[] {
    const last = (k: string) => this.lastMessage(k)?.ts ?? 0;
    return this.chatKeys()
      .filter((k) => this.isArchived(k) === !!opts.archived)
      .sort((a, b) => (this.chatPrefs[b]?.pinned ?? 0) - (this.chatPrefs[a]?.pinned ?? 0) || last(b) - last(a));
  }

  get archivedCount(): number {
    return this.chatKeys().filter((k) => this.isArchived(k)).length;
  }

  /** An unread message in this group mentions me. */
  mentionsMe(key: string): boolean {
    const me = this.account?.username;
    const n = this.getUnread(key);
    return !!me && n > 0 && this.getMessages(key).slice(-n).some((m) => m.mentions?.includes(me));
  }

  /** Read receipts off: nobody sees when I read their message, and I don't see when they read mine. */
  async setReadReceipts(on: boolean): Promise<void> {
    this.privacy = { ...this.privacy, readReceipts: on };
    await this.store.setSetting('privacy', this.privacy);
    this.emit('change');
  }

  /** My "About" line and whether others see my last seen (stored on the server). */
  async setPrivacy(p: PrivacyRequest): Promise<void> {
    await this.http('PUT', '/v1/me/privacy', p);
    if (p.about !== undefined) this.about = p.about.trim();
    if (p.hideLastSeen !== undefined) this.hideLastSeen = p.hideLastSeen;
    this.emit('change');
  }

  // ------------------------------------------------------------------ view once, calls, message info

  /**
   * Open a view-once photo: returns the file once. Call closeViewOnce() when it is closed; after that it is gone
   * for good (and the sender sees "Opened").
   */
  viewOnceFile(m: ChatMessage): Attachment | null {
    if (!m.viewOnce || m.outgoing || m.opened || !m.attachment?.data) return null;
    return m.attachment;
  }

  closeViewOnce(m: ChatMessage): void {
    if (!m.viewOnce || m.outgoing || m.opened) return;
    m.opened = true;
    if (m.attachment) {
      if (m.attachment.data) m.attachment.data.fill(0);
      m.attachment.data = undefined;
      m.attachment.ptr = undefined;
    }
    const group = isGroupKey(m.peer);
    const to = group ? m.from : m.peer;
    if (to) this.sendPayload(to, { k: 'opened', id: m.id, g: group ? groupIdOf(m.peer) : undefined }).catch(() => {});
    this.emit('change');
  }

  /** Every call in every chat, newest first (the Calls tab). */
  callHistory(): { chat: string; m: ChatMessage }[] {
    const out: { chat: string; m: ChatMessage }[] = [];
    for (const [chat, list] of this.chats) for (const m of list) if (m.call) out.push({ chat, m });
    return out.sort((a, b) => b.m.ts - a.m.ts);
  }

  /** Clear the call list (the chats keep their messages). */
  clearCallHistory(): void {
    for (const [chat, list] of this.chats) this.chats.set(chat, list.filter((m) => !m.call));
    this.emit('change');
  }

  // ------------------------------------------------------------------ chat history (device + backup)

  /** The saved history was read (nothing is written before that, so a slow start can't overwrite it). */
  private historyLoaded = false;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backupKeys: BackupKeys | null = null;
  /** A backup made with an older password (e.g. the admin reset it): waits for that password. */
  private lockedBackup: HistoryBackup | null = null;
  /** When my backup was last stored on the server (ms); null = not yet. */
  lastBackupAt: number | null = null;

  /** An older backup is waiting: restore it with the old password, or start fresh. */
  get backupLocked(): boolean {
    return !!this.lockedBackup;
  }

  private async loadHistory(): Promise<void> {
    try {
      const doc = await this.media.readDoc(HISTORY_DOC);
      const snap = doc && parseSnapshot(fromUtf8(doc));
      if (snap) this.applySnapshot(snap);
    } catch (e) {
      console.warn('could not read the chat history', e);
    }
    this.backupKeys = await this.store.getSetting<BackupKeys | null>('backupKeys', null);
    this.lockedBackup = await this.store.getSetting<HistoryBackup | null>('lockedBackup', null);
    this.lastBackupAt = await this.store.getSetting<number | null>('lastBackupAt', null);
    this.historyLoaded = true;
  }

  private applySnapshot(snap: HistorySnapshot): number {
    const added = mergeSnapshot(this.chats, snap);
    for (const c of snap.contacts) if (!this.contacts.includes(c) && !isGroupKey(c)) this.contacts.push(c);
    for (const [k, n] of Object.entries(snap.unread)) if (typeof n === 'number' && !this.unread.has(k)) this.unread.set(k, n);
    // Pinned / archived / muted chats come along to a new device.
    for (const [k, p] of Object.entries(snap.prefs ?? {})) if (!this.chatPrefs[k] && p && typeof p === 'object') this.chatPrefs[k] = p;
    void this.store.setSetting('chatPrefs', this.chatPrefs);
    void this.restoreFiles();
    this.emit('change');
    return added;
  }

  /** Files of restored messages: from this device's media store, or again from the server while it keeps them. */
  private async restoreFiles(): Promise<void> {
    for (const [chat, list] of this.chats) {
      for (const m of list) {
        const a = m.attachment;
        if (!a || a.data || a.state === 'uploading') continue;
        const saved = this.media.find(chat, m.id);
        try {
          if (saved) {
            a.data = await this.media.read(saved);
            a.state = 'ready';
            this.emit('change');
            continue;
          }
        } catch {
          /* gone from the device: try the server */
        }
        if (a.ptr && validPointer(a.ptr) && this.account) await this.fetchAttachment(m, a.ptr);
        else a.state = 'failed';
      }
    }
    this.emit('change');
  }

  private scheduleHistorySave() {
    if (!this.historyLoaded || !this.account) return;
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      void this.saveHistory().catch((e) => console.warn('could not save the chat history', e));
    }, 2000);
  }

  private snapshot(): HistorySnapshot {
    return { ...makeSnapshot(this.chats, this.contacts, this.unread), prefs: this.chatPrefs };
  }

  /** The history as last written / backed up: typing and presence changes don't touch the files. */
  private savedJson = '';
  private backedUpJson = '';

  private async saveHistory(force = false): Promise<void> {
    if (!this.account) return;
    const { savedAt: _t, ...rest } = this.snapshot();
    const json = JSON.stringify(rest);
    if (!force && json === this.savedJson) return;
    await this.media.saveDoc(HISTORY_DOC, utf8(JSON.stringify(this.snapshot())));
    this.savedJson = json;
    // At most one upload a minute while chatting.
    this.backupTimer ??= setTimeout(() => {
      this.backupTimer = null;
      void this.uploadBackup().catch((e) => console.warn('backup failed', e));
    }, 60_000);
  }

  private async uploadBackup(): Promise<void> {
    if (!this.account || !this.backupKeys || this.lockedBackup || this.status !== 'online') return;
    const json = this.savedJson;
    if (json && json === this.backedUpJson) return;
    const r = await this.http<{ updatedAt: number }>('PUT', '/v1/backup', sealBackup(this.snapshot(), this.backupKeys));
    this.backedUpJson = json;
    this.lastBackupAt = r.updatedAt;
    await this.store.setSetting('lastBackupAt', this.lastBackupAt);
  }

  /** Save and back up now (before logging out, or when the app goes to the background). */
  async flushHistory(): Promise<void> {
    if (!this.historyLoaded || !this.account) return;
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = null;
    await this.saveHistory(true);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.backupTimer = null;
    await this.uploadBackup();
  }

  /**
   * Just signed in with this password (new device, or again on this one): bring back the chats from my backup.
   * Never throws: without a backup the chats simply start empty.
   */
  private async afterSignIn(password: string): Promise<void> {
    this.historyLoaded = true;
    try {
      const fresh = await newBackupKeys(password);
      let backup: HistoryBackup | null = null;
      try {
        backup = JSON.parse(await this.http<string>('GET', '/v1/backup', undefined, undefined, true)) as HistoryBackup;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) console.warn('could not fetch the backup', e);
      }
      let keys = fresh;
      if (backup) {
        const key = await unlockBackupKey(backup, password);
        const snap = key && openBackup(backup, key);
        if (key && snap) {
          keys = { key: toBase64(key), salt: backup.salt, wrap: backup.wrap };
          const n = this.applySnapshot(snap);
          if (n) this.emit('error', `Restored ${n} message${n === 1 ? '' : 's'} from your backup`);
        } else {
          // Locked with a password from before (an admin reset it, or a new QR code): keep it for later.
          this.lockedBackup = backup;
          await this.store.setSetting('lockedBackup', backup);
        }
      }
      this.backupKeys = keys;
      await this.store.setSetting('backupKeys', keys);
      await this.saveHistory();
    } catch (e) {
      console.warn('history setup failed', e);
    }
  }

  /** Open the older backup with the password it was made with; its chats are added to these. */
  async restoreOldBackup(oldPassword: string): Promise<number> {
    const b = this.lockedBackup;
    if (!b) throw new Error('There is no older backup');
    const key = await unlockBackupKey(b, oldPassword);
    const snap = key && openBackup(b, key);
    if (!snap) throw new Error('That password does not open the backup');
    this.lockedBackup = null;
    await this.store.setSetting('lockedBackup', null);
    const n = this.applySnapshot(snap);
    await this.flushHistory().catch(() => {});
    return n;
  }

  /** Forget the older backup (its chats are gone for good) and back up these chats from now on. */
  async discardOldBackup(): Promise<void> {
    this.lockedBackup = null;
    this.backedUpJson = '';
    await this.store.setSetting('lockedBackup', null);
    this.emit('change');
    await this.flushHistory().catch(() => {});
  }

  private async wipeLocal(): Promise<void> {
    this.disconnect();
    await this.media.clear().catch((e) => console.warn('could not delete saved media', e));
    await this.store.wipe();
    this.account = null;
    this.contacts = [];
    this.chats.clear();
    this.notices = [];
    this.starred = [];
    this.statuses = [];
    this.statusPhotos.clear();
    this.unread.clear();
    this.activeChat = null;
    this.isAdmin = false;
    this.canShare = false;
    this.groups = [];
    this.policy = DEFAULT_POLICY;
    this.banned = false;
    this.moved = false;
    this.pending = false;
    this.certificate = null;
    this.company = null;
    this.isSuper = false;
    this.presence.clear();
    this.profiles.clear();
    this.avatars.clear();
    this.avatarLoading.clear();
    this.typing.clear();
    this.lastTypingSent.clear();
    if (this.historyTimer) clearTimeout(this.historyTimer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.historyTimer = this.backupTimer = null;
    this.backupKeys = null;
    this.lockedBackup = null;
    this.lastBackupAt = null;
    this.savedJson = this.backedUpJson = '';
    this.chatPrefs = {};
    this.privacy = { readReceipts: true };
    this.about = '';
    this.hideLastSeen = false;
    this.emit('change');
  }

  // ------------------------------------------------------------------ helpers

  private chatOf(peer: string): ChatMessage[] {
    let c = this.chats.get(peer);
    if (!c) this.chats.set(peer, (c = []));
    return c;
  }

  /** Put a call entry in the 1:1 chat with `peer` (called by CallManager when a call ends). */
  addCallLog(peer: string, call: CallLog, ts = Date.now()): void {
    this.addContactLocal(peer);
    // system: like other local notices it gets no receipts and can't be edited or deleted for everyone
    this.chatOf(peer).push({ id: newId(), peer, text: callLogText(call), ts, outgoing: call.outgoing, system: true, call });
    // A missed call counts as unread, like a message, unless that chat is open.
    if (call.outcome === 'missed' && this.activeChat !== peer) this.unread.set(peer, (this.unread.get(peer) ?? 0) + 1);
    this.emit('change');
  }

  private addSystem(peer: string, text: string) {
    this.chatOf(peer).push({ id: newId(), peer, text, ts: Date.now(), outgoing: false, system: true });
    this.emit('change');
  }

  private setMsgStatus(peer: string, id: string, status: ChatMessage['status']) {
    const m = this.chats.get(peer)?.find((x) => x.id === id);
    if (m && m.status !== 'delivered' && m.status !== 'read') {
      m.status = status;
      this.emit('change');
    }
  }

  private sweepExpired() {
    const now = Date.now();
    let changed = false;
    for (const [peer, list] of this.chats) {
      const kept = list.filter((m) => !m.expiresAt || m.expiresAt > now);
      if (kept.length !== list.length) {
        // drop references to content (and wipe file bytes) so nothing lingers in memory
        for (const m of list) if (m.expiresAt && m.expiresAt <= now) this.wipe(m);
        this.chats.set(peer, kept);
        changed = true;
      }
    }
    if (this.expireStatuses(now)) changed = true;
    // "typing…" that was never followed by a message
    for (const who of this.typing.values()) {
      for (const [u, until] of who) {
        if (until <= now) {
          who.delete(u);
          changed = true;
        }
      }
    }
    if (changed) this.emit('change');
  }
}

/** "online", "last seen 5 min ago", "last seen yesterday 14:05", … ("" when unknown). */
export function formatLastSeen(p: Presence | undefined, now = Date.now()): string {
  if (!p) return '';
  if (p.online) return 'online';
  if (!p.lastSeen) return 'never online';
  const ago = Math.max(0, now - p.lastSeen);
  if (ago < 60_000) return 'last seen just now';
  if (ago < 3600_000) return `last seen ${Math.floor(ago / 60_000)} min ago`;
  const d = new Date(p.lastSeen);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `last seen today ${hhmm}`;
  const yesterday = new Date(now - 86400_000);
  if (d.toDateString() === yesterday.toDateString()) return `last seen yesterday ${hhmm}`;
  return `last seen ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Human-readable names for audit log actions. */
export const AUDIT_LABELS: Record<string, string> = {
  'user.create': 'Created user',
  'user.reset_password': 'Reset password',
  'user.ban': 'Banned user',
  'user.department': 'Changed departments',
  'user.contact': 'Changed mobile / email',
  'user.profile': 'Changed profile',
  'user.invite': 'New QR invite',
  'user.join': 'Joined with QR invite',
  'user.share_on': 'Allowed saving & sharing files',
  'user.share_off': 'Stopped saving & sharing files',
  'department.create': 'Added department',
  'department.rename': 'Renamed department',
  'department.delete': 'Deleted department',
  'user.unban': 'Unbanned user',
  'user.delete': 'Deleted user',
  'catalog.create': 'Added product',
  'catalog.update': 'Changed product',
  'catalog.delete': 'Deleted product',
  'group.create': 'Created group',
  'group.update': 'Changed group',
  'group.delete': 'Deleted group',
  'settings.update': 'Changed settings',
  'rights.update': 'Changed permission',
  'helpdesk.update': 'Changed help desk',
  'community.update': 'Changed communities',
  'user.admin_on': 'Made admin',
  'user.admin_off': 'Removed as admin',
};

export function formatDuration(s: number): string {
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.round(s / 60)} minutes`;
  if (s < 86400) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}
