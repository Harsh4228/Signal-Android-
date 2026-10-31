import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowDown, ArrowUp, ImagePlus, LifeBuoy, Plus, Trash2 } from 'lucide-react-native';
import { MAX_COMPANY_ITEMS, MAX_COMPANY_ITEM_TEXT, MAX_COMPANY_ITEM_TITLE, MAX_COMPANY_NAME, type CompanyItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, Field, Header, IconButton, Logo, errorText } from '../ui';
import { pickProfilePhoto } from '../photos';
import { MessageText } from './MessageText';
import type { Route } from '../App';

type Toast = (m: string) => void;

/** The company logo (or the CellMate shield when there is none). */
export function CompanyLogo({ size = 32 }: { size?: number }) {
  const c = useClient();
  if (!c.companyLogo) return <Logo size={size} />;
  return <Image source={{ uri: c.companyLogo }} style={{ width: size, height: size, borderRadius: size * 0.26 }} />;
}

/** Top of the chat list: the company's logo and name; tap for everything the admins wrote about it. */
export function CompanyBadge({ navigate, subtitle }: { navigate: (r: Route) => void; subtitle?: React.ReactNode }) {
  const c = useClient();
  const name = c.companyProfile?.name || c.company?.name || 'CellMate';
  return (
    <Pressable onPress={() => navigate({ name: 'company' })} style={[s.row, { gap: 10, paddingLeft: 8 }]} accessibilityLabel={`About ${name}`}>
      <CompanyLogo />
      <View style={{ flexShrink: 1 }}>
        <Text style={[s.title, { fontSize: 20, fontWeight: '700' }]} numberOfLines={1}>
          {name}
        </Text>
        {subtitle}
      </View>
    </Pressable>
  );
}

/** Everyone: the company's name, logo, the admins' information sections and the help desk. */
export function CompanyInfoScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const p = c.companyProfile;
  return (
    <View style={s.fill}>
      <Header title="About the company" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <View style={[s.row, { gap: 14 }]}>
          <CompanyLogo size={64} />
          <View style={{ flex: 1 }}>
            <Text style={[s.h1, { fontSize: 22 }]}>{p?.name || c.company?.name || 'CellMate'}</Text>
            {!!c.company && <Text style={s.muted}>Company code: {c.company.code}</Text>}
          </View>
        </View>
        {p?.items.length ? (
          p.items.map((it) => (
            <View key={it.id} style={[s.card, { padding: 14, gap: 4 }]}>
              <Text style={s.section}>{it.title}</Text>
              <MessageText m={{ text: it.text } as never} />
            </View>
          ))
        ) : (
          <Text style={s.muted}>{c.isAdmin ? 'Add your office address, hours, rules or links under Admin > Company.' : 'Your admin has not added company information yet.'}</Text>
        )}
        <Button title="Help desk: whom to contact" icon={LifeBuoy} onPress={() => navigate({ name: 'help' })} />
      </ScrollView>
    </View>
  );
}

/** Admin: the company name, logo and information sections everyone sees at the top of the app. */
export function CompanyTab({ onToast }: { onToast: Toast }) {
  const c = useClient();
  const [name, setName] = useState(c.companyProfile?.name ?? c.company?.name ?? '');
  const [items, setItems] = useState<(Omit<CompanyItem, 'id'> & { id?: string })[]>(c.companyProfile?.items ?? []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.companyProfile) {
      setName(c.companyProfile.name);
      setItems(c.companyProfile.items);
    }
  }, [c.companyProfile]);
  const set = (i: number, patch: Partial<CompanyItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    setItems(next);
  };
  async function save() {
    setBusy(true);
    try {
      await client.setCompanyProfile({ ...(c.company ? { name } : {}), items: items.map((x) => ({ id: x.id ?? '', title: x.title, text: x.text })) });
      onToast('Company profile saved: everyone sees it now');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function logo() {
    try {
      const f = await pickProfilePhoto();
      if (f) await client.setCompanyLogo(f);
    } catch (e) {
      onToast(errorText(e));
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>Everyone sees the logo and name at the top of their chats. Tapping it shows the sections below and the help desk.</Text>
      <View style={[s.row, { gap: 14 }]}>
        <Pressable onPress={() => void logo()} accessibilityLabel="Change the logo">
          {c.companyLogo ? (
            <CompanyLogo size={72} />
          ) : (
            <View style={{ width: 72, height: 72, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <ImagePlus size={24} color={colors.faint} />
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 6 }}>
          <Field label="Company name" value={name} onChangeText={setName} maxLength={MAX_COMPANY_NAME} editable={!!c.company} />
          {!!c.companyLogo && (
            <Pressable onPress={() => void client.setCompanyLogo(null).catch((e) => onToast(errorText(e)))}>
              <Text style={{ color: colors.accent, fontWeight: '600' }}>Remove logo</Text>
            </Pressable>
          )}
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.section}>Information sections</Text>
        <Button title="Add section" icon={Plus} disabled={items.length >= MAX_COMPANY_ITEMS} onPress={() => setItems([...items, { title: '', text: '' }])} />
      </View>
      {!items.length && <Text style={s.muted}>For example: Office address, Working hours, Leave policy, Wi-Fi, Useful links.</Text>}
      {items.map((it, i) => (
        <View key={it.id ?? `new${i}`} style={[s.card, { padding: 12, gap: 8 }]}>
          <View style={[s.row, { gap: 4 }]}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={it.title}
              maxLength={MAX_COMPANY_ITEM_TITLE}
              placeholder="Title, e.g. Office address"
              placeholderTextColor={colors.faint}
              onChangeText={(t) => set(i, { title: t })}
            />
            <IconButton icon={ArrowUp} label="Move up" size={18} disabled={i === 0} onPress={() => move(i, -1)} />
            <IconButton icon={ArrowDown} label="Move down" size={18} disabled={i === items.length - 1} onPress={() => move(i, 1)} />
            <IconButton icon={Trash2} label="Remove" size={18} color={colors.danger} onPress={() => setItems(items.filter((_, j) => j !== i))} />
          </View>
          <TextInput
            style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={it.text}
            multiline
            maxLength={MAX_COMPANY_ITEM_TEXT}
            placeholder="Text, phone numbers or links"
            placeholderTextColor={colors.faint}
            onChangeText={(t) => set(i, { text: t })}
          />
        </View>
      ))}
      <Button variant="primary" title="Save" busy={busy} onPress={() => void save()} />
    </ScrollView>
  );
}
