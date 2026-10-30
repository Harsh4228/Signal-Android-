import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Ban,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Eye,
  Info,
  File,
  FileText,
  Forward,
  Image,
  Lock,
  MapPin,
  Megaphone,
  Mic,
  Paperclip,
  Pencil,
  Reply,
  Search,
  ShoppingBag,
  Star,
  UserRound,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  SendHorizontal,
  ShieldAlert,
  Timer,
  Trash2,
  Video,
  X,
  Flag,
} from 'lucide-react-native';
import { MessengerClient, callDetail, callMissed, callTitle, formatLastSeen, isGroupKey, type CallLog, type ChatMessage } from '@meetme/core';
import {
  AudioView,
  CatalogScreen,
  ContactCardView,
  ContactPicker,
  ForwardPicker,
  LocationCardView,
  LocationPicker,
  ProductCardView,
  QuoteView,
  ReactionChips,
  ReactionRow,
  VoiceRecorder,
} from './ChatExtras';
import { pickFile, type PickKind } from '../files';
import { copyText, saveToDevice } from '../deviceFiles';
import { AttachmentView } from './AttachmentView';
import { MessageText, ViewOnceBubble, ViewOnceViewer } from './MessageText';
import { EventView, NewEvent, NewPoll, PollView } from './PollEvent';
import { calls, client, groupCalls, useClient, useGroupCall } from '../messenger';
import { colors, s } from '../theme';
import { ChatAvatar, Header, IconButton, Sheet, clock, errorText, typingText, useBack, type SheetAction } from '../ui';
import type { Route } from '../App';
import { ReportSheet, confirmBlock } from './Safety';

function Tick({ status }: { status: NonNullable<ChatMessage['status']> }) {
  const Icon =
    status === 'sending' ? Clock3 : status === 'sent' ? Check : status === 'failed' ? CircleAlert : CheckCheck;
  const color = status === 'read' ? colors.accent : status === 'failed' ? colors.danger : colors.faint;
  return <Icon size={14} color={color} strokeWidth={2.2} />;
}

export function ChatScreen({
  peer,
  navigate,
  onError,
}: {
  peer: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  const c = useClient();
  const group = isGroupKey(peer);
  const groupInfo = c.groupOf(peer);
  const [text, setText] = useState('');
  const [verified, setVerified] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [creating, setCreating] = useState<'poll' | 'event' | 'location' | 'contact' | 'catalog' | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [viewOnce, setViewOnce] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [searching, setSearching] = useState(false);
  const [viewingCatalog, setViewingCatalog] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Back first closes search, then cancels an edit or a reply, like WhatsApp.
  useBack(searching ? () => (setSearching(false), setQuery('')) : null);
  useBack(replyTo ? () => setReplyTo(null) : null);
  useBack(editing ? () => setEditing(null) : null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = c.getMessages(peer);
  // Newest first for an inverted list: it opens at the newest message and only draws what is on screen,
  // so a chat with thousands of messages opens as fast as a short one.
  const newestFirst = [...messages].reverse();
  const timer = c.getDisappearingTimer(peer);
  const online = c.status === 'online';
  const gone = group && !groupInfo; // removed from the group, or the group was deleted

  useEffect(() => {
    if (!group) void client.getSafetyNumber(peer).then((sn) => setVerified(!!sn?.verified));
  }, [peer, group, messages.length]);

  useEffect(() => {
    if (!group) void client.refreshPresence([peer]);
  }, [peer, group]);

  async function send() {
    const t = text;
    if (!t.trim()) return;
    setText('');
    try {
      if (editing) {
        const m = editing;
        setEditing(null);
        await client.editMessage(peer, m.id, t);
      } else {
        const r = replyTo;
        setReplyTo(null);
        await client.sendText(peer, t, { replyTo: r ?? undefined });
      }
    } catch (e) {
      onError(errorText(e));
    }
  }

  async function sendPicked(kind: PickKind, viewOnce = false) {
    try {
      const file = await pickFile(kind);
      if (!file) return;
      const caption = text;
      setText('');
      const r = replyTo;
      setReplyTo(null);
      await client.sendFile(peer, file, caption, { replyTo: r ?? undefined, viewOnce });
    } catch (e) {
      onError(errorText(e));
    }
  }

  async function sendVoice(data: Uint8Array, mime: string) {
    setRecording(false);
    const r = replyTo;
    setReplyTo(null);
    try {
      await client.sendFile(peer, { name: `voice-${Date.now()}.m4a`, mime, data }, '', { replyTo: r ?? undefined });
    } catch (e) {
      onError(errorText(e));
    }
  }

  function jumpTo(id: string) {
    const index = newestFirst.findIndex((m) => m.id === id);
    if (index < 0) return onError('That message is no longer in this chat');
    setSearching(false);
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }

  const remove = (m: ChatMessage, forEveryone: boolean) =>
    client.deleteMessage(peer, m.id, forEveryone).catch((e) => onError(errorText(e)));

  function actionsFor(m: ChatMessage): SheetAction[] {
    const list: SheetAction[] = [];
    if (online && !gone && c.canSendTo(peer)) list.push({ icon: Reply, label: 'Reply', onPress: () => setReplyTo(m) });
    if (m.text && !m.deleted && c.can('copy', peer)) {
      list.push({
        icon: Copy,
        label: 'Copy',
        onPress: () => void copyText(m.text, peer).then(() => onError('Copied'), (e) => onError(errorText(e))),
      });
    }
    if (m.attachment?.data && !m.viewOnce && c.can('download', peer)) {
      const a = m.attachment;
      list.push({
        icon: Download,
        label: 'Save to phone',
        onPress: () => void saveToDevice(a, peer).then((where) => onError(`Saved to ${where}`), (e) => onError(errorText(e))),
      });
    }
    if (!m.poll && !m.event && !m.viewOnce && (!m.attachment || m.attachment.data) && c.can('forward', peer)) {
      list.push({ icon: Forward, label: 'Forward', onPress: () => setForwarding(m) });
    }
    list.push({ icon: Star, label: m.starred ? 'Unstar' : 'Star', onPress: () => client.toggleStar(m) });
    if (m.outgoing && c.canEditDelete && m.text && !m.poll && !m.event) {
      list.push({
        icon: Pencil,
        label: 'Edit',
        onPress: () => {
          setEditing(m);
          setText(m.text);
        },
      });
    }
    if (m.outgoing && !m.system) {
      list.push({
        icon: Info,
        label: 'Message info',
        onPress: () =>
          Alert.alert(
            'Message info',
            [
              `Sent: ${new Date(m.ts).toLocaleString()}`,
              group ? '' : `Delivered: ${m.deliveredAt ? new Date(m.deliveredAt).toLocaleString() : 'not yet'}`,
              group ? '' : `Read: ${m.readAt ? new Date(m.readAt).toLocaleString() : m.deliveredAt ? 'not yet (or read receipts are off)' : 'not yet'}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
      });
    }
    const author = m.outgoing || m.system ? null : (m.from ?? (group ? null : peer));
    if (author && author !== c.account?.username) list.push({ icon: Flag, label: 'Report', onPress: () => setReporting(author) });
    if (c.canClearHistory) list.push({ icon: Trash2, label: 'Delete for me', onPress: () => void remove(m, false) });
    if (c.canEditDelete && (m.outgoing || c.isAdmin)) {
      list.push({ icon: Ban, label: 'Delete for everyone', onPress: () => void remove(m, true) });
    }
    return list;
  }

  // In a group: a group call (rings everyone); otherwise a 1:1 call.
  const call = (video: boolean) => (group ? groupCalls.start(peer, video) : calls.startCall(peer, video)).catch((e) => onError(errorText(e)));
  useGroupCall();
  const ongoing = group ? groupCalls.ongoingIn(peer) : null;
  const canSend = !!text.trim() && online && !gone;
  // Typing "@" in a group suggests members to mention.
  const mentionQuery = group ? /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1]?.toLowerCase() : undefined;
  const mentionChoices =
    mentionQuery === undefined
      ? []
      : (groupInfo?.members ?? [])
          .filter((u) => u !== c.account?.username && `${u} ${c.displayName(u)}`.toLowerCase().includes(mentionQuery))
          .slice(0, 5);
  const pickMention = (u: string) => setText(text.replace(/@([^\s@]*)$/, `@${c.displayName(u)} `));
  const typing = typingText(c.getTyping(peer), group);
  const presence = group ? '' : formatLastSeen(c.getPresence(peer));
  // 1:1 chats: department next to the name, mobile · email underneath.
  const profile = group ? undefined : c.profileOf(peer);
  const contactLine = [profile?.phone, profile?.email].filter(Boolean).join(' · ');
  const subtitle = typing || (group ? c.groupMemberLine(peer) || 'Tap for group info' : contactLine || presence);

  return (
    <View style={s.fill}>
      <Header
        onBack={() => navigate({ name: 'list' })}
        title={
          <Pressable style={[s.row, { gap: 10 }]} onPress={() => navigate({ name: 'info', peer })}>
            <ChatAvatar chatKey={peer} size={38} />
            <View style={{ flex: 1 }}>
              <View style={[s.row, { gap: 5 }]}>
                <Text style={[s.textStrong, { fontSize: 16, flexShrink: 1 }]} numberOfLines={1}>
                  {c.chatTitle(peer)}
                </Text>
                {!!profile?.departments.length && (
                  <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
                    <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
                      {profile.departments.join(', ')}
                    </Text>
                  </View>
                )}
                {verified && <BadgeCheck size={15} color={colors.ok} />}
              </View>
              {!!subtitle && (
                <Text
                  style={[s.muted, { fontSize: 12 }, (!!typing || (!contactLine && presence === 'online')) && { color: colors.ok, fontWeight: '500' }]}
                  numberOfLines={1}
                >
                  {subtitle}
                  {timer && !typing ? ' · disappearing' : ''}
                </Text>
              )}
            </View>
          </Pressable>
        }
        right={
          <>
            {c.can('voiceCall', peer) && !gone && !c.isChannel(peer) && <IconButton icon={Phone} label="Voice call" disabled={!online} onPress={() => call(false)} />}
            {c.can('videoCall', peer) && !gone && !c.isChannel(peer) && <IconButton icon={Video} label="Video call" disabled={!online} onPress={() => call(true)} />}
            <IconButton icon={Search} label="Search in chat" onPress={() => (setSearching(!searching), setQuery(''))} />
          </>
        }
      />
      {ongoing && (
        <Pressable onPress={() => void groupCalls.joinOngoing(peer).catch((e) => onError(errorText(e)))} style={styles.ongoing}>
          {ongoing.video ? <Video size={16} color="#fff" /> : <Phone size={16} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }} numberOfLines={1}>
            Call in progress · {ongoing.members.map((u) => c.displayName(u)).join(', ')}
          </Text>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Join</Text>
        </Pressable>
      )}
      {searching && (
        <View style={{ backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineStrong }}>
          <View style={[s.row, { gap: 8, margin: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bg, minHeight: 42 }]}>
            <Search size={17} color={colors.faint} />
            <TextInput style={{ flex: 1, color: colors.text, fontSize: 15 }} value={query} onChangeText={setQuery} placeholder="Search messages" placeholderTextColor={colors.faint} autoFocus />
          </View>
          {!!query.trim() && (
            <View style={{ maxHeight: 240 }}>
              <FlatList
                data={c.searchMessages(peer, query).slice(0, 50)}
                keyExtractor={(m) => m.id}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={[s.muted, { padding: 12 }]}>No messages found</Text>}
                renderItem={({ item }) => (
                  <Pressable onPress={() => jumpTo(item.id)} style={({ pressed }) => [{ paddingHorizontal: 16, paddingVertical: 8 }, pressed && { backgroundColor: colors.hover }]}>
                    <Text style={[s.muted, { fontSize: 12 }]}>
                      {item.outgoing ? 'You' : c.displayName(item.from ?? peer)} · {clock(item.ts)}
                    </Text>
                    <Text style={s.text} numberOfLines={1}>
                      {MessengerClient.preview(item)}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={newestFirst}
        inverted
        keyExtractor={(m) => m.id}
        initialNumToRender={20}
        windowSize={11}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, gap: 6 }}
        onScrollToIndexFailed={(e) => listRef.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true })}
        renderItem={({ item: m }) =>
          m.call ? (
            <View style={[styles.bubble, m.outgoing ? styles.out : styles.in, styles.callEntry]}>
              <View style={[styles.callIcon, callMissed(m.call) && { backgroundColor: colors.dangerSoft }]}>
                <CallIcon c={m.call} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={s.textStrong}>{callTitle(m.call)}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>
                  {callDetail(m.call)}
                  {callDetail(m.call) ? ' · ' : ''}
                  {clock(m.ts)}
                </Text>
              </View>
              <IconButton
                icon={m.call.video ? Video : Phone}
                label={`Call ${c.displayName(peer)} back`}
                size={19}
                color={colors.accent}
                onPress={() => void call(m.call!.video)}
              />
            </View>
          ) : m.system ? (
            <View style={styles.system}>
              <ShieldAlert size={13} color={colors.muted} />
              <Text style={[s.muted, { fontSize: 12, flexShrink: 1, textAlign: 'center' }]}>{m.text}</Text>
            </View>
          ) : (
            <Pressable
              onLongPress={() => !m.deleted && setSelected(m)}
              delayLongPress={350}
              style={[
                styles.bubble,
                m.outgoing ? styles.out : styles.in,
                m.broadcast && !m.deleted && styles.announce,
                m.deleted && styles.deleted,
              ]}
            >
              {group && !m.outgoing && !!m.from && (
                <Text style={{ color: colors.accentText, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>{c.displayName(m.from)}</Text>
              )}
              {m.broadcast && !m.deleted && (
                <View style={[s.row, { gap: 5, marginBottom: 4 }]}>
                  <Megaphone size={13} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>Announcement</Text>
                </View>
              )}
              {m.forwarded && !m.deleted && (
                <View style={[s.row, { gap: 4, marginBottom: 2 }]}>
                  <Forward size={12} color={colors.muted} />
                  <Text style={[s.muted, { fontSize: 12, fontStyle: 'italic' }]}>Forwarded</Text>
                </View>
              )}
              {m.replyTo && !m.deleted && (
                <Pressable onPress={() => jumpTo(m.replyTo!.id)}>
                  <QuoteView q={m.replyTo} />
                </Pressable>
              )}
              {m.deleted ? (
                <View style={[s.row, { gap: 6 }]}>
                  <Ban size={13} color={colors.muted} />
                  <Text style={[s.muted, { fontStyle: 'italic', fontSize: 14 }]}>This message was deleted</Text>
                </View>
              ) : (
                <>
                  {m.attachment &&
                    (m.viewOnce ? (
                      <ViewOnceBubble m={m} onOpen={() => setViewOnce(m)} />
                    ) : m.attachment.kind === 'audio' ? (
                      <AudioView a={m.attachment} />
                    ) : (
                      <AttachmentView a={m.attachment} />
                    ))}
                  {m.poll && <PollView chat={peer} m={m} onError={onError} />}
                  {m.event && <EventView chat={peer} m={m} onError={onError} />}
                  {m.contact && <ContactCardView username={m.contact} navigate={navigate} />}
                  {m.location && <LocationCardView l={m.location} />}
                  {m.product && <ProductCardView p={m.product} onViewCatalog={setViewingCatalog} />}
                  {/* selectable={false}: message text cannot be copied */}
                  {!!m.text && <MessageText m={m} />}
                </>
              )}
              <View style={[s.row, { gap: 4, alignSelf: 'flex-end', marginTop: 2 }]}>
                {m.starred && <Star size={11} color="#f79009" fill="#f79009" />}
                {m.edited && <Text style={{ color: colors.faint, fontSize: 11, fontStyle: 'italic' }}>edited</Text>}
                {!!m.expiresAt && <Timer size={11} color={colors.faint} />}
                <Text style={{ color: colors.faint, fontSize: 11 }}>{clock(m.ts)}</Text>
                {m.outgoing && m.status && <Tick status={m.status} />}
              </View>
              {!m.deleted && <ReactionChips chat={peer} m={m} onError={onError} />}
            </Pressable>
          )
        }
      />

      {gone ? (
        <View style={[styles.composer, { justifyContent: 'center', paddingVertical: 16 }]}>
          <Text style={s.muted}>You are no longer a member of this group.</Text>
        </View>
      ) : !group && c.isBlocked(peer) ? (
        <Pressable onPress={() => confirmBlock(peer, onError)} style={[styles.composer, { justifyContent: 'center', paddingVertical: 16, gap: 6 }]}>
          <Ban size={14} color={colors.muted} />
          <Text style={[s.muted, { flexShrink: 1, textAlign: 'center' }]}>
            You blocked {client.displayName(peer)}. <Text style={{ color: colors.accent, fontWeight: '600' }}>Tap to unblock.</Text>
          </Text>
        </Pressable>
      ) : !c.canSendTo(peer) ? (
        <View style={[styles.composer, { justifyContent: 'center', paddingVertical: 16, gap: 6 }]}>
          <Lock size={14} color={colors.muted} />
          <Text style={[s.muted, { flexShrink: 1, textAlign: 'center' }]}>
            Only {groupInfo?.senders?.length ? groupInfo.senders.join(', ') + ' and admins' : 'admins'} can send messages in this group.
          </Text>
        </View>
      ) : recording ? (
        <View style={styles.composer}>
          <VoiceRecorder onSend={(d, mime) => void sendVoice(d, mime)} onCancel={() => setRecording(false)} onError={onError} />
        </View>
      ) : (
        <View>
          {replyTo && !editing && (
            <View style={styles.editing}>
              <Reply size={14} color={colors.accentText} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.accentText, fontSize: 13, fontWeight: '600' }}>
                  Replying to {replyTo.outgoing ? 'yourself' : c.displayName(replyTo.from ?? peer)}
                </Text>
                <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>
                  {MessengerClient.preview(replyTo)}
                </Text>
              </View>
              <IconButton icon={X} label="Cancel reply" size={18} onPress={() => setReplyTo(null)} />
            </View>
          )}
          {editing && (
            <View style={styles.editing}>
              <Pencil size={14} color={colors.accentText} />
              <Text style={{ flex: 1, color: colors.accentText, fontSize: 13, fontWeight: '600' }}>Editing message</Text>
              <IconButton
                icon={X}
                label="Cancel editing"
                size={18}
                onPress={() => {
                  setEditing(null);
                  setText('');
                }}
              />
            </View>
          )}
          {mentionChoices.length > 0 && (
            <View style={styles.mentions}>
              {mentionChoices.map((u) => (
                <Pressable key={u} onPress={() => pickMention(u)} style={({ pressed }) => [s.row, { gap: 10, padding: 10 }, pressed && { backgroundColor: colors.hover }]}>
                  <ChatAvatar chatKey={u} size={30} />
                  <Text style={s.text}>{c.displayName(u)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.composer}>
            <View style={styles.field}>
              {!editing && (
                <IconButton icon={Paperclip} label="Attach" disabled={!online} color={colors.muted} onPress={() => setAttachOpen(true)} />
              )}
              <TextInput
                style={[styles.input, !!editing && { paddingLeft: 14 }]}
                value={text}
                onChangeText={(t) => {
                  setText(t);
                  if (t && !editing) client.notifyTyping(peer);
                }}
                placeholder={online ? 'Write a message…' : 'Offline - reconnecting…'}
                placeholderTextColor={colors.faint}
                multiline
                // Keep the keyboard from learning / suggesting what you type.
                autoCorrect={false}
                spellCheck={false}
                keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
                importantForAutofill="no"
              />
            </View>
            {!text.trim() && !editing && c.can('sendFiles', peer) ? (
              <Pressable
                style={[styles.send, !online && { opacity: 0.4 }]}
                disabled={!online}
                onPress={() => setRecording(true)}
                accessibilityLabel="Record a voice message"
              >
                <Mic size={20} color="#fff" strokeWidth={2} />
              </Pressable>
            ) : (
              <Pressable
                style={[styles.send, !canSend && { opacity: 0.4 }]}
                disabled={!canSend}
                onPress={send}
                accessibilityLabel={editing ? 'Save' : 'Send'}
              >
                {editing ? <Check size={20} color="#fff" strokeWidth={2.2} /> : <SendHorizontal size={20} color="#fff" strokeWidth={2} />}
              </Pressable>
            )}
          </View>
        </View>
      )}

      {attachOpen && (
        <Sheet
          title="Send securely"
          onClose={() => setAttachOpen(false)}
          actions={[
            ...(c.can('sendFiles', peer)
              ? [
                  { icon: Image, label: 'Photo', onPress: () => void sendPicked('photo') },
                  { icon: Eye, label: 'Photo, view once', onPress: () => void sendPicked('photo', true) },
                  { icon: FileText, label: 'PDF document', onPress: () => void sendPicked('pdf') },
                  { icon: File, label: 'Other file', onPress: () => void sendPicked('file') },
                ]
              : []),
            { icon: BarChart3, label: 'Poll', onPress: () => setCreating('poll') },
            { icon: CalendarDays, label: 'Event', onPress: () => setCreating('event') },
            { icon: MapPin, label: 'Location', onPress: () => setCreating('location') },
            { icon: UserRound, label: 'Contact', onPress: () => setCreating('contact') },
            { icon: ShoppingBag, label: 'Catalog', onPress: () => setCreating('catalog') },
          ]}
        />
      )}
      {creating === 'poll' && <NewPoll chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'event' && <NewEvent chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'location' && <LocationPicker chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'contact' && <ContactPicker chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'catalog' && <CatalogScreen chat={peer} onClose={() => setCreating(null)} onToast={onError} />}
      {viewingCatalog && <CatalogScreen owner={viewingCatalog} onClose={() => setViewingCatalog(null)} onToast={onError} />}
      {forwarding && <ForwardPicker m={forwarding} onClose={() => setForwarding(null)} onToast={onError} />}
      {reporting && <ReportSheet user={reporting} chat={peer} onClose={() => setReporting(null)} onToast={onError} />}
      {viewOnce && <ViewOnceViewer m={viewOnce} onClose={() => setViewOnce(null)} />}
      {selected && <Sheet title="Message" onClose={() => setSelected(null)} actions={actionsFor(selected)} />}
      {selected && (
        // Quick reactions float above the long-press menu, like WhatsApp.
        <View style={styles.reactFloat} pointerEvents="box-none">
          <View style={[s.card, { borderRadius: 999, paddingHorizontal: 6 }]}>
            <ReactionRow chat={peer} m={selected} onDone={() => setSelected(null)} onError={onError} />
          </View>
        </View>
      )}
    </View>
  );
}

function CallIcon({ c }: { c: CallLog }) {
  const color = callMissed(c) ? colors.danger : colors.accent;
  if (c.video) return <Video size={18} color={color} />;
  if (c.outcome === 'missed') return <PhoneMissed size={18} color={color} />;
  return c.outgoing ? <PhoneOutgoing size={18} color={color} /> : <PhoneIncoming size={18} color={color} />;
}

const styles = StyleSheet.create({
  ongoing: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#00a884' },
  mentions: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
  },
  reactFloat: { position: 'absolute', left: 12, right: 12, top: '22%', alignItems: 'center' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  out: {
    alignSelf: 'flex-end',
    backgroundColor: colors.out,
    borderColor: colors.outBorder,
    borderBottomRightRadius: 4,
  },
  in: {
    alignSelf: 'flex-start',
    backgroundColor: colors.in,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  announce: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  callEntry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8, minWidth: 230 },
  callIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  deleted: { backgroundColor: colors.surface2, borderColor: colors.line },
  system: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    maxWidth: '88%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginVertical: 8,
  },
  editing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 4,
    backgroundColor: colors.accentSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingRight: 12,
    minHeight: 44,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15.5,
    maxHeight: 120,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
