# MeetMe – private end-to-end encrypted messenger

Android · iOS (React Native) · Windows / macOS / Linux (Electron) · Node.js relay server

```
meetme/
├── packages/core/   Shared TypeScript: Signal protocol (X3DH + Double Ratchet), client, call manager
├── server/          Node.js relay: public keys + encrypted envelopes only (SQLite, node:sqlite)
├── desktop/         Electron + React app
└── mobile/          React Native app (Android + iOS)
```

## Security design

| Feature | How |
|---|---|
| End-to-end encryption | X3DH key agreement + Double Ratchet (per Signal specs), X25519 / Ed25519 / HKDF-SHA256 / XChaCha20-Poly1305 from the audited `@noble` libraries |
| Forward secrecy + post-compromise security | New ratchet keys on every reply; message keys deleted after use |
| Server knows nothing | Server stores only usernames, password hash (scrypt), **public** keys, and ciphertext that is deleted once delivered |
| Man-in-the-middle detection | 60-digit safety numbers + key-change warnings (trust on first use) |
| Encrypted video/voice calls | WebRTC DTLS-SRTP; SDP fingerprints travel through the encrypted channel, so the server cannot MITM calls |
| Hide IP in calls | With a TURN server configured, calls are relay-only |
| No files on device | No attachment saving/export, no storage permissions, downloads blocked (desktop). Message history lives **in RAM only** |
| Keys at rest | iOS Keychain (this-device-only), Android Keystore (AES-GCM), Electron `safeStorage` (DPAPI / Keychain) |
| Screenshots | Android `FLAG_SECURE` (fully blocked); desktop `setContentProtection` (blocked); iOS: hidden in recordings and app switcher, screenshot blanked by `react-native-capture-protection`, and the other person is notified |
| Disappearing messages | Per-chat timer, synced between both people |
| Metadata padding | Messages padded to 160-byte blocks |
| Backups | Android backups and device transfer disabled; iOS keychain items not in iCloud |

**Limits:** no app can stop someone photographing the screen with another camera. The server still sees *who* talks to *whom* and *when* (Signal hides the sender with "sealed sender"; that isn't implemented here yet). This code has **not** had an independent security audit. Get one before you trust it with life-or-death secrets.

## Run it

Needs Node.js 22+ (24 LTS recommended).

```powershell
cd meetme
npm install
npm test               # crypto + end-to-end tests
npm run server         # http://localhost:8080
npm run desktop        # opens the desktop app (dev mode)
```

### Android

1. Install **JDK 17** and **Android Studio** (SDK Platform 36, Build-Tools, NDK, an emulator).
2. Set `JAVA_HOME` and `ANDROID_HOME` (usually `%LOCALAPPDATA%\Android\Sdk`).
3. Start an emulator or plug in a phone with USB debugging enabled.

```powershell
cd meetme\mobile
npm install
npm run android
```

On the emulator the server address is `http://10.0.2.2:8080`. On a real phone use your PC's LAN IP (`http://192.168.x.x:8080`) or, better, your HTTPS server.

### iOS (needs a Mac with Xcode)

```bash
cd meetme/mobile && npm install
cd ios && pod install && cd ..
npm run ios
```

### Desktop installers

```powershell
npm run dist:win -w @meetme/desktop     # dist/MeetMe Setup.exe
npm run dist:mac -w @meetme/desktop     # on a Mac
```

## Production deployment

1. Run the server behind **HTTPS** (e.g. Caddy: `caddy reverse-proxy --from chat.example.com --to localhost:8080`) and set `TRUST_PROXY=1`. Clients then use `https://chat.example.com`.
2. Add a TURN server (coturn) so calls work behind every NAT and your IP stays hidden:
   ```
   # /etc/turnserver.conf
   use-auth-secret
   static-auth-secret=<long random secret>
   realm=chat.example.com
   ```
   Then start MeetMe with `TURN_URLS=turn:chat.example.com:3478?transport=udp,turns:chat.example.com:5349` and `TURN_SECRET=<same secret>`.
3. Release builds on Android block plain `http://`, so use HTTPS.

Server environment variables: `PORT` (8080), `HOST`, `DB_PATH` (`./data/meetme.db`), `STUN_URLS`, `TURN_URLS`, `TURN_SECRET`, `TRUST_PROXY`, `ADMIN_USERS`.

## Photos, PDFs and files

Tap **📎** in a chat (or in the admin 📢 window) and choose Photo, PDF or File. Up to 25 MB.

- The file is encrypted on your device with a new random key (XChaCha20-Poly1305). The server only gets the ciphertext, under a random ID, and deletes it after 14 days. The key and a SHA-256 checksum travel inside the end-to-end encrypted message.
- The receiver downloads, verifies and decrypts it **into memory only**. Nothing is written to disk and there is no Save button.
- **Photos** are shown in the chat and in a full-screen viewer.
- **PDFs** open in a built-in view-only viewer. Desktop uses pdf.js drawn to canvas. Android uses an offline pdf.js page bundled in the app (`npm run build:pdfviewer`). iOS uses WKWebView from memory. PDF JavaScript never runs.
- **Other file types** show their name and size, but can't be opened inside MeetMe, because opening them would mean saving them for another app.
- Screenshot blocking covers the viewers too. On Android they are drawn inside the protected window, not in a separate dialog.

## Employee accounts (admin creates ID + password)

When `ADMIN_USERS` is set, **sign-up is closed**. Only the admin creates their own account with "Admin: create the first account". Set `OPEN_REGISTRATION=1` to allow anyone.

1. Admin → **👥 Employees** → enter an ID. A random temporary password is filled in; 🎲 makes a new one. Click **Create**, then copy or share the login text with the employee.
2. The employee installs MeetMe → **Log in** with the server, ID and password.
3. **On first login the employee must choose their own password.** After that the admin's temporary password stops working, so the admin can't log in as the employee.
4. The employee's encryption keys are created on their device at login. The server only stores a password hash plus a separate random **device secret** that authenticates that device.
5. Logging in on a new device signs out the old one. Its keys are wiped, and messages still queued for the old device are dropped, because only the old keys could decrypt them.
6. Admin can **reset a password** (the employee must set a new one at next login) or **remove** an employee, which signs them out everywhere.
7. Anyone can **change their password** or **log out** in ⚙ Settings.

## Admin announcements

Start the server with one or more admin usernames:

```powershell
$env:ADMIN_USERS='harsh'; npm run server
```

Admins see **📢** in the app. It sends one announcement to every registered user. Each copy is end-to-end encrypted separately, so the server still can't read it. It shows up as **📢 Announcement** in each employee's chat with the admin, and employees reply to the admin privately. The badge is only shown for real admins, so other users can't fake announcements. Admins **cannot** read other people's chats; that's what end-to-end encryption guarantees.

## Roadmap ideas
- Sealed sender (hide sender from server)
- Push notifications (FCM/APNs wake-up with no content) for calls while the app is closed
- Encrypted view-once images (in memory, never saved)
- Group chats (Sender Keys)
- Linked devices
- App lock (PIN / biometrics)
