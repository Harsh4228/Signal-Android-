import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Share, Text, TextInput, View } from 'react-native';
import { generatePassword, USERNAME_RE, type AdminUser } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import type { Route } from '../App';

/** Admin: create employee IDs, reset passwords, remove employees. */
export function EmployeesScreen({ navigate, onToast }: { navigate: (r: Route) => void; onToast: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [id, setId] = useState('');
  const [pw, setPw] = useState(generatePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    client
      .listAllUsers()
      .then(setUsers)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  const shareLogin = (username: string, password: string, reset: boolean) => {
    const message =
      `MeetMe login\nServer: ${client.account?.serverUrl}\nID: ${username}\nPassword: ${password}\n` +
      '(You will be asked to choose your own password when you log in.)';
    Alert.alert(
      reset ? 'New temporary password' : 'Employee created',
      `${message}\n\nThis password is only shown now.`,
      [
        { text: 'Done', style: 'cancel' },
        { text: 'Share…', onPress: () => void Share.share({ message }) },
      ],
    );
  };

  async function create() {
    setError(null);
    const username = id.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return setError('ID: 3-32 characters, a-z 0-9 _ .');
    setBusy(true);
    try {
      await client.createEmployee(username, pw);
      shareLogin(username, pw, false);
      setId('');
      setPw(generatePassword());
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const reset = (u: string) =>
    Alert.alert('Reset password', `Give ${u} a new temporary password?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        onPress: async () => {
          const temp = generatePassword();
          try {
            await client.resetEmployeePassword(u, temp);
            shareLogin(u, temp, true);
            reload();
          } catch (e) {
            onToast(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  const remove = (u: string) =>
    Alert.alert('Remove employee', `Delete ${u}'s account? They are logged out everywhere.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.removeEmployee(u);
            onToast(`${u} removed`);
            reload();
          } catch (e) {
            onToast(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'list' })}>
          <Text style={s.icon}>‹</Text>
        </Pressable>
        <Text style={[s.text, { fontWeight: '700', fontSize: 17 }]}>👥 Employees</Text>
      </View>

      <View style={{ padding: 12, gap: 8 }}>
        <Text style={s.h4}>Add employee</Text>
        <TextInput
          style={s.input}
          value={id}
          onChangeText={(t) => setId(t.toLowerCase())}
          placeholder="Employee ID, e.g. ravi.k"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={[s.row, { gap: 8 }]}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={pw}
            onChangeText={setPw}
            placeholder="Temporary password"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={[s.button, { marginTop: 0 }]} onPress={() => setPw(generatePassword())}>
            <Text style={s.buttonText}>🎲</Text>
          </Pressable>
        </View>
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Pressable
          style={[s.button, s.primary, (busy || id.length < 3 || pw.length < 8) && { opacity: 0.5 }]}
          disabled={busy || id.length < 3 || pw.length < 8}
          onPress={create}
        >
          <Text style={s.buttonText}>Create employee</Text>
        </Pressable>
        <Text style={s.h4}>All accounts ({users?.length ?? '…'})</Text>
      </View>

      <FlatList
        data={users ?? []}
        keyExtractor={(u) => u.username}
        renderItem={({ item: u }) => (
          <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 8, gap: 10 }]}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{u.username[0]!.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '600' }]}>
                {u.username}
                {u.admin ? <Text style={{ color: '#f5a524', fontSize: 11 }}> ADMIN</Text> : null}
              </Text>
              <Text style={s.muted}>{u.active ? '● Active' : '○ Not logged in yet'}</Text>
            </View>
            {u.username !== client.account?.username && (
              <>
                <Pressable style={s.iconBtn} onPress={() => reset(u.username)}>
                  <Text style={s.icon}>🔑</Text>
                </Pressable>
                <Pressable style={s.iconBtn} onPress={() => remove(u.username)}>
                  <Text style={s.icon}>🗑</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      />
    </View>
  );
}
