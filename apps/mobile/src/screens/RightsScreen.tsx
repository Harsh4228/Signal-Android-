import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Building2, ChevronRight, CircleAlert, Plus, Search, ShieldCheck, Trash2, User, UsersRound, X } from 'lucide-react-native';
import {
  FEATURES,
  FEATURE_KEYS,
  shortId,
  type AdminUser,
  type Feature,
  type GroupInfo,
  type RightRule,
  type RightScope,
} from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Header, IconButton, errorText, useBack } from '../ui';

type Toast = (m: string) => void;

const SCOPE_LABEL: Record<RightScope, string> = { company: 'Everyone', department: 'Department', group: 'Group', user: 'Person' };
const SCOPE_ICON = { company: Building2, department: Building2, group: UsersRound, user: User };

/** Allowed for everyone in the company: the company rule, or the built-in default. */
const companyAllows = (rules: RightRule[], f: Feature) =>
  rules.find((r) => r.feature === f && r.scope === 'company')?.allow ?? FEATURES[f].default;

/** "Allow" / "Block" pill. */
function StatePill({ allow }: { allow: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: allow ? colors.okSoft : colors.dangerSoft }]}>
      <Text style={{ color: allow ? colors.ok : colors.danger, fontSize: 12, fontWeight: '700' }}>{allow ? 'Allowed' : 'Blocked'}</Text>
    </View>
  );
}

/** Three choices: back to what applies above, allow, block. */
function Choice({ value, onChange, inherit = 'Default' }: { value: boolean | null; onChange: (v: boolean | null) => void; inherit?: string }) {
  const items: [boolean | null, string][] = [
    [null, inherit],
    [true, 'Allow'],
    [false, 'Block'],
  ];
  return (
    <View style={styles.segment}>
      {items.map(([v, label]) => {
        const on = value === v;
        const tint = v === true ? colors.ok : v === false ? colors.danger : colors.accent;
        return (
          <Pressable key={label} onPress={() => onChange(v)} style={[styles.segItem, on && { backgroundColor: colors.surface, borderColor: tint }]}>
            <Text style={{ color: on ? tint : colors.muted, fontWeight: '600', fontSize: 13 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Company admin: every protected function, who may use it. Most specific wins: a person in a group, then the person,
 * then a group (in its chat), then a department, then everyone.
 */
export function RightsTab({
  users,
  groups,
  departments,
  onToast,
}: {
  users: AdminUser[] | null;
  groups: GroupInfo[] | null;
  departments: string[];
  onToast: Toast;
}) {
  const [rules, setRules] = useState<RightRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Feature | null>(null);
  const load = useCallback(() => {
    client.getRightRules().then(setRules, (e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  if (open && rules) {
    return (
      <FeatureRules
        feature={open}
        rules={rules}
        users={users ?? []}
        groups={groups ?? []}
        departments={departments}
        onRules={setRules}
        onClose={() => setOpen(null)}
        onToast={onToast}
      />
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
      <Banner kind="ok" icon={ShieldCheck}>
        Decide who may use each function. Set it for everyone, then make exceptions for a department, a group or a person.
        Admins can always use everything.
      </Banner>
      {error && (
        <Banner kind="error" icon={CircleAlert}>
          {error}
        </Banner>
      )}
      {!rules ? (
        <Text style={s.muted}>Loading…</Text>
      ) : (
        <View style={[s.card, { overflow: 'hidden' }]}>
          {FEATURE_KEYS.map((f, i) => {
            const exceptions = rules.filter((r) => r.feature === f && r.scope !== 'company').length;
            return (
              <Pressable key={f} onPress={() => setOpen(f)} style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && { backgroundColor: colors.hover }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.textStrong}>{FEATURES[f].label}</Text>
                  <Text style={s.muted}>
                    {companyAllows(rules, f) ? 'Everyone' : 'Nobody'}
                    {exceptions ? ` · ${exceptions} exception${exceptions > 1 ? 's' : ''}` : ''}
                  </Text>
                </View>
                <StatePill allow={companyAllows(rules, f)} />
                <ChevronRight size={18} color={colors.faint} />
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function FeatureRules({
  feature,
  rules,
  users,
  groups,
  departments,
  onRules,
  onClose,
  onToast,
}: {
  feature: Feature;
  rules: RightRule[];
  users: AdminUser[];
  groups: GroupInfo[];
  departments: string[];
  onRules: (r: RightRule[]) => void;
  onClose: () => void;
  onToast: Toast;
}) {
  useBack(onClose);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = rules.filter((r) => r.feature === feature && r.scope !== 'company');
  const everyone = companyAllows(rules, feature);
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? 'Group';
  const personName = (u: string) => users.find((x) => x.username === u)?.name || shortId(u);

  async function change(scope: RightScope, target: string, allow: boolean | null, member = '') {
    setBusy(true);
    try {
      onRules(await client.setRight({ feature, scope, target, member, allow }));
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (r: RightRule) =>
    r.scope === 'department'
      ? r.target
      : r.scope === 'group'
        ? r.member
          ? `${personName(r.member)} in ${groupName(r.target)}`
          : groupName(r.target)
        : personName(r.target);
  const order: RightScope[] = ['department', 'group', 'user'];

  return (
    <View style={s.fill}>
      <Header title={FEATURES[feature].label} onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
        <Text style={[s.muted, { lineHeight: 19 }]}>{FEATURES[feature].hint}.</Text>
        <View style={[s.card, s.row, { padding: 16, gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.textStrong}>Everyone in the company</Text>
            <Text style={[s.muted, { marginTop: 3 }]}>{everyone ? 'Allowed, except the blocks below' : 'Blocked, except the ones allowed below'}</Text>
          </View>
          <Switch
            value={everyone}
            disabled={busy}
            onValueChange={(v) => void change('company', '', v)}
            trackColor={{ true: colors.accent, false: colors.lineStrong }}
            thumbColor="#fff"
          />
        </View>

        <Text style={s.section}>Exceptions</Text>
        {mine.length === 0 && <Text style={s.muted}>None. Everyone follows the setting above.</Text>}
        {mine.length > 0 && (
          <View style={[s.card, { overflow: 'hidden' }]}>
            {[...mine]
              .sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope) || label(a).localeCompare(label(b)))
              .map((r, i) => {
                const Icon = SCOPE_ICON[r.scope];
                return (
                  <View key={`${r.scope}:${r.target}:${r.member}`} style={[styles.row, i > 0 && styles.rowLine]}>
                    <Icon size={18} color={colors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.text} numberOfLines={1}>
                        {label(r)}
                      </Text>
                      <Text style={s.muted}>{r.member ? 'Person in a group' : SCOPE_LABEL[r.scope]}</Text>
                    </View>
                    <Pressable disabled={busy} onPress={() => void change(r.scope, r.target, !r.allow, r.member)}>
                      <StatePill allow={r.allow} />
                    </Pressable>
                    <IconButton icon={Trash2} label="Remove exception" color={colors.danger} onPress={() => void change(r.scope, r.target, null, r.member)} />
                  </View>
                );
              })}
          </View>
        )}
        <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
          Tap Allowed / Blocked to switch it. The most specific setting wins: a person, then a group (in its chat), then a
          department, then everyone.
        </Text>
        {adding ? (
          <AddException
            users={users}
            groups={groups}
            departments={departments}
            defaultAllow={!everyone}
            onCancel={() => setAdding(false)}
            onAdd={async (items, allow) => {
              for (const it of items) await change(it.scope, it.target, allow, it.member);
              setAdding(false);
            }}
          />
        ) : (
          <Button title="Add exception" icon={Plus} onPress={() => setAdding(true)} />
        )}
      </ScrollView>
    </View>
  );
}

type AddScope = 'department' | 'group' | 'user' | 'member';
const ADD_LABEL: Record<AddScope, string> = { department: 'Department', group: 'Group', user: 'Person', member: 'Person in a group' };

/**
 * Add exceptions: one or more departments, groups or people, or chosen people inside one group (they may use it
 * in that group only, e.g. download PDFs in "Accounts team" while their department may not).
 */
function AddException({
  users,
  groups,
  departments,
  defaultAllow,
  onCancel,
  onAdd,
}: {
  users: AdminUser[];
  groups: GroupInfo[];
  departments: string[];
  defaultAllow: boolean;
  onCancel: () => void;
  onAdd: (items: { scope: RightScope; target: string; member?: string }[], allow: boolean) => Promise<void>;
}) {
  const [scope, setScope] = useState<AddScope>('user');
  const [picked, setPicked] = useState<string[]>([]);
  const [inGroup, setInGroup] = useState('');
  const [allow, setAllow] = useState(defaultAllow);
  const [query, setQuery] = useState('');
  const name = (u: string) => {
    const x = users.find((p) => p.username === u);
    return x?.name ? `${x.name} (${shortId(u)})` : shortId(u);
  };
  const options = useMemo((): [string, string][] => {
    if (scope === 'department') return departments.map((d) => [d, d]);
    if (scope === 'group' || (scope === 'member' && !inGroup)) return groups.map((g) => [g.id, g.name]);
    if (scope === 'member') {
      const g = groups.find((x) => x.id === inGroup);
      return (g?.members ?? []).filter((u) => !users.find((p) => p.username === u)?.admin).map((u) => [u, name(u)]);
    }
    return users.filter((u) => !u.admin && !u.moved).map((u) => [u.username, name(u.username)]);
  }, [scope, inGroup, users, groups, departments]);
  const q = query.trim().toLowerCase();
  const shown = options.filter(([, l]) => l.toLowerCase().includes(q)).slice(0, 80);
  const choosingGroup = scope === 'member' && !inGroup;
  const toggle = (id: string) => {
    if (choosingGroup) return setInGroup(id);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const add = () =>
    onAdd(
      picked.map((id) => (scope === 'member' ? { scope: 'group', target: inGroup, member: id } : { scope, target: id })),
      allow,
    );
  return (
    <View style={[s.card, { padding: 14, gap: 12 }]}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={s.title}>Add exception</Text>
        <IconButton icon={X} label="Cancel" onPress={onCancel} />
      </View>
      <View style={[styles.segment, { flexWrap: 'wrap' }]}>
        {(['user', 'department', 'group', 'member'] as const).map((sc) => (
          <Pressable
            key={sc}
            onPress={() => {
              setScope(sc);
              setPicked([]);
              setInGroup('');
            }}
            style={[styles.segItem, { minWidth: '45%' }, scope === sc && { backgroundColor: colors.surface, borderColor: colors.accent }]}
          >
            <Text style={{ color: scope === sc ? colors.accent : colors.muted, fontWeight: '600', fontSize: 13 }}>{ADD_LABEL[sc]}</Text>
          </Pressable>
        ))}
      </View>
      {scope === 'member' && (
        <Text style={s.muted}>
          {inGroup ? `People in "${groups.find((g) => g.id === inGroup)?.name}": they get this only inside that group.` : 'First choose the group:'}
        </Text>
      )}
      {scope === 'member' && !!inGroup && <Button title="Choose another group" onPress={() => (setInGroup(''), setPicked([]))} />}
      {options.length > 8 && (
        <View style={styles.search}>
          <Search size={16} color={colors.faint} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 8 }}
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}
      <View style={{ gap: 4 }}>
        {shown.length === 0 && <Text style={s.muted}>Nothing to choose{scope === 'department' ? ': add departments first' : ''}.</Text>}
        {shown.map(([id, l]) => {
          const on = picked.includes(id);
          return (
            <Pressable key={id} onPress={() => toggle(id)} style={[styles.option, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
              <Text style={[s.text, on && { color: colors.accentText, fontWeight: '600' }]} numberOfLines={1}>
                {on ? '✓ ' : ''}
                {l}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!choosingGroup && (
        <>
          <Choice value={allow} onChange={(v) => setAllow(v ?? defaultAllow)} inherit={defaultAllow ? 'Allow' : 'Block'} />
          <Button
            variant="primary"
            title={`${allow ? 'Allow' : 'Block'}${picked.length > 1 ? ` for ${picked.length}` : ''}`}
            disabled={!picked.length}
            onPress={() => void add()}
          />
        </>
      )}
    </View>
  );
}
/**
 * A group's own rights (group admins and company admins): for everyone in the group's chat, and for single members.
 * They only apply inside this group.
 */
export function GroupRightsScreen({ group, onClose, onToast }: { group: GroupInfo; onClose: () => void; onToast: Toast }) {
  const [rules, setRules] = useState<RightRule[] | null>(null);
  const [open, setOpen] = useState<Feature | null>(null);
  useBack(open ? () => setOpen(null) : onClose);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client.getRightRules(group.id).then(setRules, (e) => onToast(errorText(e)));
  }, [group.id, onToast]);

  async function change(feature: Feature, allow: boolean | null, member = '') {
    setBusy(true);
    try {
      setRules(await client.setRight({ feature, scope: 'group', target: group.id, member, allow }));
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const forAll = (f: Feature) => rules?.find((r) => r.feature === f && !r.member)?.allow ?? null;
  const members = group.members.filter((u) => u !== client.account?.username);

  return (
    <View style={s.fill}>
      <Header
        title="Group permissions"
        subtitle={<Text style={s.muted}>{group.name}</Text>}
        onBack={open ? () => setOpen(null) : onClose}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
        {!rules ? (
          <Text style={s.muted}>Loading…</Text>
        ) : open ? (
          <>
            <Text style={s.title}>{FEATURES[open].label}</Text>
            <Text style={s.muted}>{FEATURES[open].hint}, in this group.</Text>
            <Text style={s.section}>Everyone in the group</Text>
            <Choice value={forAll(open)} onChange={(v) => void change(open, v)} inherit="Company setting" />
            <Text style={s.section}>Members</Text>
            <View style={[s.card, { overflow: 'hidden' }]}>
              {members.map((u, i) => {
                const v = rules.find((r) => r.feature === open && r.member === u)?.allow ?? null;
                return (
                  <View key={u} style={[styles.row, i > 0 && styles.rowLine, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                    <Text style={s.textStrong}>{client.displayName(u)}</Text>
                    <Choice value={v} onChange={(nv) => void change(open, nv, u)} inherit="As group" />
                  </View>
                );
              })}
            </View>
            {busy && <Text style={s.muted}>Saving…</Text>}
          </>
        ) : (
          <>
            <Text style={[s.muted, { lineHeight: 19 }]}>
              Allow or block functions inside this group's chat, for everyone in it or for single members. Outside the group
              the company's settings apply.
            </Text>
            <View style={[s.card, { overflow: 'hidden' }]}>
              {FEATURE_KEYS.map((f, i) => {
                const all = forAll(f);
                const people = rules.filter((r) => r.feature === f && r.member).length;
                return (
                  <Pressable key={f} onPress={() => setOpen(f)} style={({ pressed }) => [styles.row, i > 0 && styles.rowLine, pressed && { backgroundColor: colors.hover }]}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.textStrong}>{FEATURES[f].label}</Text>
                      <Text style={s.muted}>
                        {all === null ? 'Company setting' : all ? 'Allowed in this group' : 'Blocked in this group'}
                        {people ? ` · ${people} member${people > 1 ? 's' : ''}` : ''}
                      </Text>
                    </View>
                    {all !== null && <StatePill allow={all} />}
                    <ChevronRight size={18} color={colors.faint} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 10, padding: 3, gap: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  option: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
