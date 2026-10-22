import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import {
  Crosshair,
  ExternalLink,
  Forward,
  ImagePlus,
  MapPin,
  MessageSquare,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import {
  AVATAR_MIMES,
  MAX_AVATAR_BYTES,
  MAX_PLACE_NAME,
  MAX_PRODUCT_DESC,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
  toBase64,
  type ProductInput,
  REACTIONS,
  mapsUrl,
  type Attachment,
  type ChatMessage,
  type Product,
  type ProductCard,
  type Quote,
  type SharedLocation,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Button, ChatAvatar, IconButton, errorText, shortTime } from '../ui';
import { play, startRecording, stopPlaying, stopRecording } from '../voice';
import { pickFile } from '../files';
import type { Route } from '../App';

const who = (u: string) => (u === client.account?.username ? 'You' : u);

export function QuoteView({ q }: { q: Quote }) {
  return (
    <View style={styles.quote}>
      <Text style={{ color: colors.accentText, fontSize: 12, fontWeight: '700' }}>{who(q.from)}</Text>
      <Text style={[s.muted, { fontSize: 13 }]} numberOfLines={2}>
        {q.text || 'Message'}
      </Text>
    </View>
  );
}

export function ReactionChips({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const me = client.account?.username ?? '';
  const entries = Object.entries(m.reactions ?? {});
  if (!entries.length) return null;
  const counts = new Map<string, string[]>();
  for (const [u, e] of entries) counts.set(e, [...(counts.get(e) ?? []), u]);
  return (
    <View style={[s.row, { gap: 4, marginTop: 4, flexWrap: 'wrap' }]}>
      {[...counts].map(([e, users]) => (
        <Pressable
          key={e}
          onPress={() => client.react(chat, m.id, users.includes(me) ? null : e).catch((err) => onError(errorText(err)))}
          style={[styles.chip, users.includes(me) && { backgroundColor: colors.accentSoft, borderColor: '#b9cbf7' }]}
        >
          <Text style={{ fontSize: 13 }}>
            {e}
            {users.length > 1 ? ` ${users.length}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The 6 quick reactions, shown at the top of the long-press menu. */
export function ReactionRow({ chat, m, onDone, onError }: { chat: string; m: ChatMessage; onDone: () => void; onError: (e: string) => void }) {
  const mine = m.reactions?.[client.account?.username ?? ''];
  return (
    <View style={[s.row, { justifyContent: 'space-around', paddingVertical: 8 }]}>
      {REACTIONS.map((e) => (
        <Pressable
          key={e}
          onPress={() => {
            onDone();
            client.react(chat, m.id, mine === e ? null : e).catch((err) => onError(errorText(err)));
          }}
          style={[styles.reactBtn, mine === e && { backgroundColor: colors.accentSoft }]}
        >
          <Text style={{ fontSize: 26 }}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ContactCardView({ username, navigate }: { username: string; navigate: (r: Route) => void }) {
  const me = client.account?.username;
  return (
    <View style={{ minWidth: 220, gap: 8 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Avatar name={username} size={40} />
        <View>
          <Text style={s.textStrong}>{username}</Text>
          <Text style={[s.muted, { fontSize: 12 }]}>Contact</Text>
        </View>
      </View>
      {username !== me && (
        <Pressable
          style={styles.cardAction}
          onPress={() => void client.addContact(username).then(() => navigate({ name: 'chat', peer: username })).catch(() => {})}
        >
          <MessageSquare size={15} color={colors.accent} />
          <Text style={styles.cardActionText}>Message</Text>
        </Pressable>
      )}
    </View>
  );
}

export function LocationCardView({ l }: { l: SharedLocation }) {
  return (
    <View style={{ minWidth: 220, gap: 8 }}>
      <View style={[s.row, { gap: 10 }]}>
        <View style={[styles.pin, { backgroundColor: colors.dangerSoft }]}>
          <MapPin size={20} color={colors.danger} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.textStrong}>{l.name || 'Shared location'}</Text>
          <Text style={[s.muted, { fontSize: 12 }]}>
            {l.lat.toFixed(5)}, {l.lng.toFixed(5)}
          </Text>
        </View>
      </View>
      <Pressable style={styles.cardAction} onPress={() => void Linking.openURL(mapsUrl(l))}>
        <ExternalLink size={15} color={colors.accent} />
        <Text style={styles.cardActionText}>Open in Google Maps</Text>
      </Pressable>
    </View>
  );
}

export function ProductCardView({ p, onViewCatalog }: { p: ProductCard; onViewCatalog?: (owner: string) => void }) {
  return (
    <View style={{ minWidth: 220, gap: 6 }}>
      <View style={[s.row, { gap: 10 }]}>
        <View style={[styles.pin, { backgroundColor: colors.okSoft }]}>
          <ShoppingBag size={20} color={colors.ok} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.textStrong}>{p.name}</Text>
          {!!p.price && <Text style={{ color: colors.ok, fontWeight: '700' }}>{p.price}</Text>}
        </View>
      </View>
      {!!p.description && <Text style={[s.muted, { fontSize: 13 }]}>{p.description}</Text>}
      {!!p.owner && onViewCatalog && (
        <Pressable style={styles.cardAction} onPress={() => onViewCatalog(p.owner!)}>
          <ShoppingBag size={15} color={colors.accent} />
          <Text style={styles.cardActionText}>View {p.owner === client.account?.username ? 'my' : `${p.owner}'s`} catalog</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Voice message player (decrypted into a temporary private file only while playing). */
export function AudioView({ a }: { a: Attachment }) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [len, setLen] = useState(0);
  const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  useEffect(() => () => void (playing && stopPlaying()), [playing]);
  if (!a.data) {
    return (
      <View style={[s.row, { gap: 8, minWidth: 200 }]}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={s.muted}>{a.state === 'failed' ? 'Voice message unavailable' : 'Loading…'}</Text>
      </View>
    );
  }
  async function toggle() {
    if (playing) {
      await stopPlaying();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    try {
      await play(a, (p, l) => {
        setPos(p);
        if (l) setLen(l);
      });
    } catch {
      // unsupported format etc.
    }
    setPlaying(false);
    setPos(0);
  }
  return (
    <View style={[s.row, { gap: 10, minWidth: 220, paddingVertical: 2 }]}>
      <Pressable onPress={() => void toggle()} style={styles.play} accessibilityLabel={playing ? 'Stop' : 'Play'}>
        {playing ? <Pause size={18} color="#fff" /> : <Play size={18} color="#fff" />}
      </Pressable>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${len ? Math.min(100, (pos / len) * 100) : 0}%` }]} />
      </View>
      <Text style={[s.muted, { fontSize: 12 }]}>{fmt(playing ? pos : len)}</Text>
      <Mic size={14} color={colors.muted} />
    </View>
  );
}

/** Voice recorder bar (replaces the text field while recording). */
export function VoiceRecorder({ onSend, onCancel, onError }: { onSend: (d: Uint8Array, mime: string) => void; onCancel: () => void; onError: (e: string) => void }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    startRecording(setSecs).catch((e) => {
      onError(errorText(e));
      onCancel();
    });
    return () => void stopRecording(false);
  }, []);
  useEffect(() => {
    if (secs >= 300) void finish(true);
  }, [secs]);
  async function finish(keep: boolean) {
    const r = await stopRecording(keep);
    if (keep && r) onSend(r.data, r.mime);
    else onCancel();
  }
  return (
    <View style={[s.row, { flex: 1, gap: 10, minHeight: 44 }]}>
      <IconButton icon={Trash2} label="Cancel recording" color={colors.danger} onPress={() => void finish(false)} />
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />
      <Text style={[s.text, { flex: 1 }]}>
        Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </Text>
      <Pressable style={styles.send} onPress={() => void finish(true)} disabled={secs < 1} accessibilityLabel="Send voice message">
        <Send size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

/** Full-screen panel inside the app window (not a RN <Modal>, so screenshots stay blocked). */
function Overlay({ title, icon: Icon, onClose, children }: { title: string; icon: typeof X; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <IconButton icon={X} label="Close" onPress={onClose} />
        <Icon size={20} color={colors.accent} />
        <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

export function LocationPicker({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const [coords, setCoords] = useState('');
  const [name, setName] = useState('');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = (() => {
    const m = coords.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const [lat, lng] = [Number(m[1]), Number(m[2])];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  })();

  async function locate() {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return onError('Location permission denied');
    }
    setLocating(true);
    Geolocation.getCurrentPosition(
      (p) => {
        setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      () => {
        setLocating(false);
        onError("Couldn't get your location. Turn on Location, or type the coordinates.");
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  async function send() {
    if (!parsed) return;
    setBusy(true);
    try {
      await client.sendLocation(chat, { ...parsed, name: name.trim() || undefined });
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Overlay title="Share location" icon={MapPin} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.muted, { lineHeight: 19 }]}>
          Sent end-to-end encrypted. No map service is contacted unless someone taps "Open in Google Maps".
        </Text>
        <Button icon={Crosshair} title={locating ? 'Finding you…' : 'Use my current location'} busy={locating} onPress={() => void locate()} />
        <Text style={s.label}>Coordinates or Google Maps link</Text>
        <TextInput style={s.input} value={coords} onChangeText={setCoords} placeholder="19.0760, 72.8777" placeholderTextColor={colors.faint} autoCapitalize="none" />
        {!!coords && !parsed && <Text style={{ color: colors.danger }}>Enter latitude, longitude like 19.0760, 72.8777.</Text>}
        <Text style={s.label}>Place name (optional)</Text>
        <TextInput style={s.input} value={name} maxLength={MAX_PLACE_NAME} onChangeText={setName} placeholder="e.g. Head office, Gate 2" placeholderTextColor={colors.faint} />
        <Button variant="primary" icon={Send} title="Send location" busy={busy} disabled={!parsed} onPress={send} />
      </ScrollView>
    </Overlay>
  );
}

export function ContactPicker({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const c = useClient();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) client.searchUsers(q).then(setFound).catch(() => setFound([]));
      else setFound([]);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const list = q.trim() ? found : c.contacts.filter((u) => u !== chat);
  return (
    <Overlay title="Share contact" icon={UserRound} onClose={onClose}>
      <View style={[styles.searchBox]}>
        <Search size={18} color={colors.faint} />
        <TextInput style={{ flex: 1, color: colors.text, fontSize: 15 }} value={q} onChangeText={setQ} placeholder="Search colleagues" placeholderTextColor={colors.faint} autoCapitalize="none" autoFocus />
      </View>
      <FlatList
        data={list}
        keyExtractor={(u) => u}
        ListEmptyComponent={<Text style={[s.muted, { padding: 16 }]}>{q.trim() ? 'Nobody found' : 'No contacts yet. Search by name.'}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
            onPress={() =>
              void client
                .sendContact(chat, item)
                .then(onClose)
                .catch((e) => onError(errorText(e)))
            }
          >
            <Avatar name={item} size={40} />
            <Text style={s.textStrong}>{item}</Text>
          </Pressable>
        )}
      />
    </Overlay>
  );
}

export function ForwardPicker({ m, onClose, onToast }: { m: ChatMessage; onClose: () => void; onToast: (e: string) => void }) {
  const c = useClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const keys = c.chatKeys().filter((k) => c.canSendTo(k));
  async function send() {
    setBusy(true);
    const results = await Promise.allSettled(picked.map((k) => client.forwardMessage(k, m)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    onToast(failed ? `Forwarded to ${picked.length - failed}; ${failed} failed` : `Forwarded to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
    onClose();
  }
  return (
    <Overlay title="Forward to…" icon={Forward} onClose={onClose}>
      <FlatList
        data={keys}
        keyExtractor={(k) => k}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
            onPress={() => setPicked((p) => (p.includes(item) ? p.filter((x) => x !== item) : [...p, item]))}
          >
            <View style={[styles.box, picked.includes(item) && { backgroundColor: colors.accent, borderColor: colors.accent }]} />
            <ChatAvatar chatKey={item} size={40} />
            <Text style={[s.textStrong, { flex: 1 }]}>{c.chatTitle(item)}</Text>
          </Pressable>
        )}
      />
      <View style={{ padding: 12 }}>
        <Button variant="primary" icon={Forward} title={`Forward${picked.length > 1 ? ` (${picked.length})` : ''}`} busy={busy} disabled={!picked.length} onPress={send} />
      </View>
    </Overlay>
  );
}

export function StarredScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const list = c.starredMessages();
  return (
    <Overlay title="Starred messages" icon={Star} onClose={() => navigate({ name: 'list' })}>
      <FlatList
        data={list}
        keyExtractor={(x) => `${x.chat}:${x.msgId}`}
        ListEmptyComponent={<Text style={[s.muted, { padding: 16, textAlign: 'center' }]}>No starred messages. Long-press a message and tap Star.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
            onPress={() => navigate({ name: 'chat', peer: item.chat })}
          >
            <ChatAvatar chatKey={item.chat} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={s.textStrong} numberOfLines={1}>
                {who(item.from)} <Text style={s.muted}>· {c.chatTitle(item.chat)}</Text>
              </Text>
              <Text style={s.muted} numberOfLines={2}>
                {item.preview}
              </Text>
            </View>
            <Text style={[s.muted, { fontSize: 12 }]}>{shortTime(item.ts)}</Text>
          </Pressable>
        )}
      />
    </Overlay>
  );
}

/**
 * A catalog, like WhatsApp Business. Mine (default): add, change, delete and share my products. Someone else's
 * (`owner`): browse and share. With `chat`, tapping Send puts the product into that chat.
 */
export function CatalogScreen({
  chat,
  owner,
  onClose,
  onToast,
}: {
  chat?: string;
  owner?: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const c = useClient();
  const mine = !owner || owner === c.account?.username;
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sharing, setSharing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const reload = () =>
    client
      .listProducts(mine ? undefined : owner)
      .then(setProducts)
      .catch((e) => {
        onToast(errorText(e));
        setProducts([]);
      });
  useEffect(() => void reload(), []);
  const card = (p: Product) => ({ id: p.id, owner: p.owner, name: p.name, price: p.price || undefined, description: p.description || undefined });
  const remove = (p: Product) =>
    Alert.alert('Delete product', `Delete ${p.name} from your catalog?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void client
            .deleteProduct(p.id)
            .then(reload)
            .catch((e) => onToast(errorText(e))),
      },
    ]);

  if (editing) {
    return (
      <ProductForm
        product={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
        onError={onToast}
      />
    );
  }
  const sendTo = (key: string, p: Product) =>
    client
      .sendProduct(key, card(p))
      .then(() => {
        onToast(`Shared ${p.name} with ${c.chatTitle(key)}`);
        onClose();
      })
      .catch((e) => onToast(errorText(e)));

  if (sharing) {
    return (
      <Overlay title={`Share ${sharing.name} to…`} icon={Send} onClose={() => setSharing(null)}>
        <FlatList
          data={c.chatKeys().filter((k) => c.canSendTo(k))}
          keyExtractor={(k) => k}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]} onPress={() => void sendTo(item, sharing)}>
              <ChatAvatar chatKey={item} size={40} />
              <Text style={s.textStrong}>{c.chatTitle(item)}</Text>
            </Pressable>
          )}
        />
      </Overlay>
    );
  }
  return (
    <Overlay title={chat ? `Send a product to ${c.chatTitle(chat)}` : mine ? 'My catalog' : `${owner}'s catalog`} icon={ShoppingBag} onClose={onClose}>
      {mine && !chat && (
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <Button variant="primary" icon={Plus} title="Add product" onPress={() => setEditing('new')} />
        </View>
      )}
      {products === null ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={
            <Text style={[s.muted, { textAlign: 'center', padding: 24 }]}>
              {mine
                ? chat
                  ? 'Your catalog is empty. Add products first: ⋮ → My catalog.'
                  : 'Your catalog is empty. Tap "Add product" to start it. Colleagues can open it from your profile.'
                : `${owner} has no products yet.`}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[s.card, s.row, { padding: 12, gap: 12, alignItems: 'flex-start' }]}>
              <ProductThumb p={item} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.textStrong}>{item.name}</Text>
                {!!item.price && <Text style={{ color: colors.ok, fontWeight: '700' }}>{item.price}</Text>}
                {!!item.description && (
                  <Text style={[s.muted, { fontSize: 13 }]} numberOfLines={3}>
                    {item.description}
                  </Text>
                )}
                <View style={[s.row, { gap: 4, marginTop: 6 }]}>
                  <Pressable style={[styles.cardAction, { paddingHorizontal: 14 }]} onPress={() => (chat ? void sendTo(chat, item) : setSharing(item))}>
                    <Send size={14} color={colors.accent} />
                    <Text style={styles.cardActionText}>{chat ? 'Send' : 'Share'}</Text>
                  </Pressable>
                  {mine && !chat && <IconButton icon={Pencil} label="Edit" size={18} onPress={() => setEditing(item)} />}
                  {mine && !chat && <IconButton icon={Trash2} label="Delete" size={18} color={colors.danger} onPress={() => remove(item)} />}
                </View>
              </View>
            </View>
          )}
        />
      )}
    </Overlay>
  );
}

/** Add or change a product in my catalog (photo from the phone's gallery). */
function ProductForm({ product, onClose, onSaved, onError }: { product: Product | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product?.price ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  /** undefined = keep, null = remove, value = new photo */
  const [photo, setPhoto] = useState<{ mime: string; data: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function choosePhoto() {
    try {
      const f = await pickFile('photo');
      if (!f) return;
      if (!(AVATAR_MIMES as readonly string[]).includes(f.mime)) throw new Error('Please choose a JPEG, PNG or WebP photo');
      if (f.data.length > MAX_AVATAR_BYTES) throw new Error('Photo too large (max 2 MB)');
      setPhoto({ mime: f.mime, data: toBase64(f.data) });
    } catch (e) {
      onError(errorText(e));
    }
  }

  async function save() {
    setBusy(true);
    try {
      const input: ProductInput = { name, price, description, ...(photo !== undefined ? { photo } : {}) };
      if (product) await client.updateProduct(product.id, input);
      else await client.createProduct(input);
      onSaved();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  const hasPhoto = photo ? true : photo === null ? false : !!product?.photo;
  return (
    <Overlay title={product ? 'Edit product' : 'Add product'} icon={ShoppingBag} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={[s.row, { gap: 12 }]}>
          {photo ? (
            <Image source={{ uri: `data:${photo.mime};base64,${photo.data}` }} style={styles.thumb} />
          ) : hasPhoto && product ? (
            <ProductThumb p={product} />
          ) : (
            <View style={styles.thumb}>
              <ShoppingBag size={24} color={colors.faint} />
            </View>
          )}
          <View style={{ flex: 1, gap: 6 }}>
            <Button icon={ImagePlus} title={hasPhoto ? 'Change photo' : 'Add photo'} onPress={() => void choosePhoto()} />
            {hasPhoto && <Button icon={Trash2} title="Remove photo" variant="danger" onPress={() => setPhoto(null)} />}
          </View>
        </View>
        <TextInput style={s.input} value={name} maxLength={MAX_PRODUCT_NAME} onChangeText={setName} placeholder="Product name" placeholderTextColor={colors.faint} />
        <TextInput style={s.input} value={price} maxLength={MAX_PRODUCT_PRICE} onChangeText={setPrice} placeholder="Price (optional), e.g. ₹4,999" placeholderTextColor={colors.faint} />
        <TextInput
          style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]}
          value={description}
          maxLength={MAX_PRODUCT_DESC}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={colors.faint}
          multiline
        />
        <Button variant="primary" title={product ? 'Save' : 'Add to my catalog'} busy={busy} disabled={!name.trim()} onPress={save} />
      </ScrollView>
    </Overlay>
  );
}

function ProductThumb({ p }: { p: Product }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    client
      .productPhoto(p)
      .then((u) => !gone && setUri(u))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [p.id, p.photo]);
  return (
    <View style={styles.thumb}>{uri ? <Image source={{ uri }} style={{ width: 72, height: 72 }} /> : <ShoppingBag size={24} color={colors.faint} />}</View>
  );
}

const styles = StyleSheet.create({
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: 'rgba(16,24,40,0.05)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
  },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reactBtn: { padding: 6, borderRadius: 999 },
  pin: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  cardActionText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(16,24,40,0.12)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: colors.accent },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 44,
  },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.lineStrong },
  thumb: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
