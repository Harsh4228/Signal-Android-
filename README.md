# MeetMe – private end-to-end encrypted messenger

Android · iOS (React Native) · Windows / macOS / Linux (Electron) · Node.js relay server

```
meetme/
├── apps/
│   ├── server/      Node.js relay (PostgreSQL or SQLite): public keys + ciphertext → Docker image
│   ├── mobile/      React Native, one codebase for Android + iOS           → .apk/.aab + iOS app
│   └── desktop/     Electron + React (Windows / macOS / Linux)             → .exe / .dmg / .AppImage
├── packages/
│   └── core/        Shared TypeScript: Signal protocol (X3DH + Double Ratchet), client, call manager
├── infra/           Production stack: docker-compose (server + Caddy HTTPS + coturn TURN)
└── .github/workflows/
    ├── ci.yml       every push: typecheck + tests
    ├── server.yml   push to main: server image → ghcr.io
    ├── android.yml  version tag: APK + AAB
    ├── ios.yml      version tag: iOS build on a GitHub Mac
    └── desktop.yml  version tag: Windows / macOS / Linux installers
```

Each app builds and deploys on its own. All three use the same `packages/core`, so the encryption is written and tested once.

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
cd meetme
npm install                 # shared core (once)
npm run mobile:install
npm run android
```

On the emulator the server address is `http://10.0.2.2:8080`. On a real phone use your PC's LAN IP (`http://192.168.x.x:8080`) or, better, your HTTPS server.

### iOS (needs a Mac with Xcode)

```bash
cd meetme && npm install && npm run mobile:install
cd apps/mobile/ios && pod install && cd ../../..
npm run ios
```

### Desktop installers

```powershell
npm run dist:win -w @meetme/desktop     # dist/MeetMe Setup.exe
npm run dist:mac -w @meetme/desktop     # on a Mac
```

## Production deployment

### Server (one Linux VPS with Docker)

1. Point your domain's DNS **A record** (e.g. `chat.example.com`) at the VPS IP.
2. Open firewall ports: `80`, `443` (TCP), `3478` (TCP + UDP), `49160-49400` (UDP, for calls).
3. On the VPS:
   ```bash
   git clone https://github.com/Harsh4228/meetme.git && cd meetme/infra
   cp .env.example .env        # set DOMAIN, ADMIN_USERS, TURN_SECRET, POSTGRES_PASSWORD (openssl rand -hex 32)
   docker compose up -d --build
   ```
   Caddy gets a free HTTPS certificate automatically. Clients then use `https://chat.example.com`.
4. Update later: `git pull && docker compose up -d --build`.
5. Backups: the `backup` container writes a PostgreSQL dump to `infra/backups/` every night and keeps 14 days. Copy that folder off the server regularly. Restore with `docker compose exec -T db pg_restore -U meetme -d meetme --clean < backups/meetme-DATE.dump`.
6. More users: run several `server` containers against the same database (`docker compose up -d --scale server=3`). They pass messages to each other through PostgreSQL, so no Redis is needed. Put attachments on shared storage when the servers run on different machines.

### App releases (built by GitHub Actions)

Push a version tag and GitHub builds everything; download the files from the run's **Artifacts**:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

- **Android:** for Play-Store-ready signing, create an upload key once (`keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`), **back it up safely**, and add the secrets listed at the top of `.github/workflows/android.yml`. Locally, put the `MEETME_UPLOAD_*` values in `%USERPROFILE%\.gradle\gradle.properties`, never in the repo.
- **iOS:** the workflow checks it compiles on a GitHub Mac. Signed builds and TestFlight need an Apple Developer account.
- **Desktop:** installers are unsigned until you buy code-signing certificates (Windows) or join the Apple Developer Program (macOS).

Release builds on Android block plain `http://`, so use HTTPS.

Server environment variables: `DATABASE_URL` (PostgreSQL; without it a SQLite file at `DB_PATH` is used), `PORT` (8080), `HOST`, `DB_PATH` (`./data/meetme.db`), `ATTACHMENTS_DIR`, `STUN_URLS`, `TURN_URLS`, `TURN_SECRET`, `TRUST_PROXY`, `ADMIN_USERS`, `OPEN_REGISTRATION`, `PG_POOL_SIZE`.

Run the server tests against PostgreSQL too: `TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db npm test -w @meetme/server`.

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
