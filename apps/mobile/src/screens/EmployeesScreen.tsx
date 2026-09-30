import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Share, Text, View } from 'react-native';
import { CircleAlert, KeyRound, RefreshCw, Trash2, UserPlus } from 'lucide-react-native';
import { generatePassword, USERNAME_RE, type AdminUser } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Banner, Button, Field, Header, IconButton, errorText } from '../ui';
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
        { text: 'Share', onPress: () => void Share.share({ message }) },
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
      setError(errorText(e));
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
            onToast(errorText(e));
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
            onToast(errorText(e));
          }
        },
      },
    ]);

  return (
    <View style={s.fill}>
      <Header title="Employees" onBack={() => navigate({ name: 'list' })} />
      <FlatList
        data={users ?? []}
        keyExtractor={(u) => u.username}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ padding: 16, paddingBottom: 0 }}>
            <View style={[s.card, { padding: 16, gap: 12 }]}>
              <Text style={s.title}>Add employee</Text>
              <Field value={id} onChangeText={(t) => setId(t.toLowerCase())} placeholder="Employee ID, e.g. ravi.k" />
              <View style={[s.row, { gap: 4 }]}>
                <View style={{ flex: 1 }}>
                  <Field value={pw} onChangeText={setPw} placeholder="Temporary password" />
                </View>
                <IconButton icon={RefreshCw} label="Generate new password" onPress={() => setPw(generatePassword())} />
              </View>
              {error && (
                <Banner kind="error" icon={CircleAlert}>
                  {error}
                </Banner>
              )}
              <Button
                variant="primary"
                icon={UserPlus}
                title="Create employee"
                busy={busy}
                disabled={id.length < 3 || pw.length < 8}
                onPress={create}
              />
            </View>
            <Text style={s.section}>All accounts ({users?.length ?? '…'})</Text>
          </View>
        }
        renderItem={({ item: u, index }) => (
          <View style={{ marginHorizontal: 16 }}>
            <View
              style={[
                s.row,
                {
                  gap: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: colors.surface,
                  borderColor: colors.line,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderTopWidth: 1,
                },
                index === 0 && { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
                index === (users?.length ?? 0) - 1 && {
                  borderBottomWidth: 1,
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                },
              ]}
            >
              <Avatar name={u.username} size={40} />
              <View style={{ flex: 1 }}>
                <View style={[s.row, { gap: 6 }]}>
                  <Text style={[s.textStrong, { flexShrink: 1 }]} numberOfLines={1}>
                    {u.username}
                  </Text>
                  {u.admin && (
                    <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
                      <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '600' }}>Admin</Text>
                    </View>
                  )}
                </View>
                <View style={[s.row, { gap: 5, marginTop: 2 }]}>
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: u.active ? colors.online : colors.faint }}
                  />
                  <Text style={[s.muted, { fontSize: 12 }]}>{u.active ? 'Active' : 'Not logged in yet'}</Text>
                </View>
              </View>
              {u.username !== client.account?.username && (
                <>
                  <IconButton icon={KeyRound} label="Reset password" onPress={() => reset(u.username)} size={20} />
                  <IconButton icon={Trash2} label="Remove" color={colors.danger} onPress={() => remove(u.username)} size={20} />
                </>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}
