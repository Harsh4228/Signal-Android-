# CellMate – private end-to-end encrypted messenger

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
| App lock | 6-digit PIN (PBKDF2-hashed, never stored) on desktop and mobile, plus fingerprint / Face ID on phones; auto-lock after idle / background time; wrong guesses throttled |
| Push notifications | Content-free wake-ups through Firebase: only "New message" / "Incoming call", never the sender or text; sent only if a message is still waiting after a few seconds |
| Sealed sender | After two people have exchanged a first message, their messages are posted **without logging in** inside a sealed envelope. The server stores them with no sender, so it only knows who receives, not who sent. Server-signed 24-hour sender certificates + a per-person delivery key (shared only inside encrypted messages) stop impersonation and anonymous spam |
| Backups | Android backups and device transfer disabled; iOS keychain items not in iCloud |

**Limits:** no app can stop someone photographing the screen with another camera. The server still sees who *receives* messages and when, and the IP address messages come from (use a VPN or Tor to hide that). The very first message to a new contact is not sealed, because the delivery key has not been exchanged yet. This code has **not** had an independent security audit. Get one before you trust it with life-or-death secrets.

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
npm run dist:win -w @meetme/desktop     # dist/CellMate Setup.exe
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

## Push notifications (Firebase)

Without Firebase everything works, but a closed app only gets messages when it is opened again. To wake phones:

1. Create a project at https://console.firebase.google.com (free).
2. **Android:** add an Android app with package name `app.meetme`, download `google-services.json` and put it in `apps/mobile/android/app/`.
3. **iOS:** add an iOS app with bundle ID `app.meetme`, download `GoogleService-Info.plist` into `apps/mobile/ios/MeetMe/`. In Firebase > Project settings > Cloud Messaging, upload your APNs key (.p8) from the Apple Developer account.
4. **Server:** Firebase > Project settings > Service accounts > *Generate new private key*. Copy the JSON file to the server as `infra/secrets/fcm-service-account.json` (already wired up in `docker-compose.yml`) and restart: `docker compose up -d`. The server log then shows `push: on`. Without Docker, set `FCM_SERVICE_ACCOUNT_FILE=/path/to/file.json`.
5. For CI builds, add the two config files as repository secrets `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST` (paste the file contents).

These files are in `.gitignore`: keep them out of the repository. What Google and Apple can see: that *some* CellMate server woke this phone at a certain time. Never who wrote or what.

## Photos, PDFs and files

Tap **📎** in a chat (or in the admin 📢 window) and choose Photo, PDF or File. Up to 25 MB.

- The file is encrypted on your device with a new random key (XChaCha20-Poly1305). The server only gets the ciphertext, under a random ID, and deletes it after 14 days. The key and a SHA-256 checksum travel inside the end-to-end encrypted message.
- The receiver downloads, verifies and decrypts it **into memory only**. By default nothing is written to disk and there is no Save button.
- **Files stay inside CellMate:** everyone can **share a file to another chat** (it is encrypted again for that chat), but nobody, admins included, can save a file to the computer or phone or share it to another app. There is no Save dialog on desktop and no share sheet on mobile.
- **Photos** are shown in the chat and in a full-screen viewer.
- **PDFs** open in a built-in view-only viewer. Desktop uses pdf.js drawn to canvas. Android uses an offline pdf.js page bundled in the app (`npm run build:pdfviewer`). iOS uses WKWebView from memory. PDF JavaScript never runs.
- **Other file types** show their name and size, but can't be opened inside CellMate, because opening them would mean saving them for another app.
- Screenshot blocking covers the viewers too. On Android they are drawn inside the protected window, not in a separate dialog.

## Employee accounts (admin creates ID + password)

When `ADMIN_USERS` is set, **sign-up is closed**. Only the admin creates their own account with "Admin: create the first account". Set `OPEN_REGISTRATION=1` to allow anyone.

1. Admin → **🛡 Admin → Users → Add user** → enter an ID. A random temporary password is filled in; ↻ makes a new one. Click **Create**, then copy or share the login text with the employee.
2. The employee installs CellMate → **Log in** with the server, ID and password.
3. **On first login the employee must choose their own password.** After that the admin's temporary password stops working, so the admin can't log in as the employee.
4. The employee's encryption keys are created on their device at login. The server only stores a password hash plus a separate random **device secret** that authenticates that device.
5. Logging in on a new device signs out the old one. Its keys are wiped, and messages still queued for the old device are dropped, because only the old keys could decrypt them.
6. Admin can **reset a password** (the employee must set a new one at next login) or **remove** an employee, which signs them out everywhere.
7. Anyone can **change their password** or **log out** in ⚙ Settings.

## Admin panel

Admins see **🛡 Admin** in the app (desktop and mobile). Everything in it is admin-only on the server; other users get `403`.

| Tab | What the admin can do |
|---|---|
| **Overview** | Counts: users, online now, not logged in yet, banned, groups, admins; latest admin actions |
| **Users** | Search all accounts, filter (online / not logged in / banned / **department**), see online + last seen, create (tick one or more departments), change department, reset password, **ban / unban**, delete, open a chat |
| **Departments** | Add, rename and delete the departments admins pick from. A user can be in several. Renaming updates everyone in it; deleting takes it off its members (their other departments stay) |
| **Groups** | Create groups, rename, add / remove members, delete. Only admins can do this |
| **Activity log** | Every admin action (accounts, bans, groups, settings) with who, what and when |
| **Settings** | Allow employees to **edit and delete** their own messages, and to **clear their chat history** (clear chat, delete for me, disappearing messages). Both off by default; admins always can |

- **Block** signs the user out for good: their app deletes its keys and goes back to the sign-in screen, their password stops working and any QR invite is cancelled. While blocked they can't sign in or use a QR, and nobody can message them. **Unblock** alone doesn't let them back in: they need a **new QR code** from the admin (offered right after unblocking). Their account, name, photo, departments and catalog are kept.
- **Groups** stay end-to-end encrypted: the server stores only the name and member list; the sender's device encrypts a separate copy for each member. Members only accept group messages from people the server lists as members. Members who are banned or have not logged in yet are skipped.
- **Edit / delete for everyone** travel inside the encrypted messages. Admins can also remove anyone's message in chats they are in (moderation). "Delete for me" is always allowed.
- **Online / last seen** comes from the server (it knows when you are connected anyway). **Typing…** is sent end-to-end encrypted.

## Admin announcements

Start the server with one or more admin usernames:

```powershell
$env:ADMIN_USERS='harsh'; npm run server
```

Admins see **📢** in the app. It sends one announcement to every registered user, or under **Send to** only to the departments you pick (for example just Sales). Each copy is end-to-end encrypted separately, so the server still can't read it. It shows up as **📢 Announcement** in each employee's chat with the admin, and employees reply to the admin privately. The badge is only shown for real admins, so other users can't fake announcements. Admins **cannot** read other people's chats; that's what end-to-end encryption guarantees.

## Adding people: admin-made profiles + QR invite

1. Admin → **Add user**: full name, ID, mobile, email, profile photo and departments. No password.
2. CellMate shows a **QR code** (works once, for 7 days). Check the **server address** in it: a phone can't reach `localhost`, so use the PC's network address or your real server.
3. The person opens CellMate on their phone → **Scan QR code** → chooses their password → done. On a computer they paste the **invite code** (shown under the QR; *Copy invite code*).
4. **Profiles are locked:** name, photo, mobile and email are set by the admin; people see them read-only in Settings, and the server refuses changes from anyone but an admin.
5. **New phone or forgotten password:** admin → the user's **New QR code**. Scanning it lets them choose a new password and signs out their old device.

The full name is shown instead of the ID in chat lists, chat headers and contact info. The invite secret is stored only as a hash on the server and works once.

## Media and docs

Open a chat's details (click the name or photo) to see **Media and docs**: every photo and document sent or received in that chat, like WhatsApp. **Media** shows photos in a grid, **Docs** lists PDFs and other files with who sent them and when. Click one to view it.

- Message text is still kept in memory only. Photos and documents are now also **kept on the device**, so this page still has them after the app restarts.
- Each file is encrypted with a random key that lives in the OS keychain (DPAPI / Keychain / Android Keystore). The files on disk (`media/` in the app data folder) are unreadable without it.
- A file sent to several chats (e.g. with an announcement) is stored once.
- **Not saved:** files in disappearing-message chats.
- **Removed** when the message is deleted for everyone, when the chat is cleared, and when you log out. Employees can delete single files only when the admin allows clearing history.
- Files can be shared to other chats but never exported out of the app.

## In a chat (like WhatsApp)

All of these are end-to-end encrypted like normal messages. Desktop: hover a message for its buttons; phone: long-press it.

| Feature | How |
|---|---|
| **Reply** | ↩ on a message; the reply shows the original quoted above it (click the quote to jump there) |
| **Reactions** | 🙂+ (desktop) or the emoji row on long-press: 👍 ❤️ 😂 😮 😢 🙏, one per person, everyone in the chat sees them |
| **Forward** | ➦ to one or more chats; the copy is encrypted again and marked *Forwarded*. Polls and events can't be forwarded |
| **Star** | ☆ keeps a message in ⋮ → **Starred messages** (a short text snapshot is kept encrypted on the device, so the list survives restarts) |
| **Search** | 🔍 in the chat header searches that chat's messages, captions and file names |
| **Voice messages** | 🎤 (shown when the text box is empty): record, then send or 🗑. Up to 5 minutes |
| **Polls** | 📎 → Poll: question, 2–12 options, optionally several answers. Votes update live for everyone; *View votes* shows who picked what |
| **Events** | 📎 → Event: name, description, start / end, place. Everyone can answer Going / Maybe / Not going |
| **Location** | 📎 → Location: your current position or typed / pasted coordinates, plus a place name. The card has *Open in Google Maps*; no map service is contacted unless someone taps it |
| **Contact** | 📎 → Contact: share a colleague; the card has a *Message* button |
| **Catalog** | 📎 → Catalog: send a product card into the chat |

**Catalogs** (like WhatsApp Business): **every user has their own** (⋮ → **My catalog**) and adds, edits and deletes their products (photo, name, price, description) on desktop or phone. Nobody sees someone else's products in *My catalog*. Share a product into a chat with 📎 → Catalog or *Share*; the card has **View catalog**. A person's catalog also shows in their contact info (**Catalog**, when they have products). Only the owner can change a catalog; admins can remove a product (moderation), and deleting a user deletes their catalog. Like a WhatsApp catalog it is visible to colleagues, so it is stored on the server readable; shared product cards are end-to-end encrypted.

**Voice messages on phones:** the audio library records to and plays from a file, so a recording is read into memory and deleted straight away, and a voice message being played sits decrypted in the app's private cache only while it plays. iPhones can't play voice messages recorded on desktop (WebM); Android and desktop play everything.

## Status

Like WhatsApp: click **◌ Status** (next to 🔔), then **T** for a text status on a colour or the photo button for a photo with a caption. It is shown to your contacts and the people in your groups for **24 hours**, then disappears everywhere.

- Contacts' updates show with a green ring (grey once viewed); **Recent updates** first, then **Viewed updates**. A green dot on the Status button means something new.
- The player shows each update for 5 seconds; click / tap left or right to go back or on, hold to pause.
- On your own status, **Seen by X of Y** lists who viewed it and when; the bin deletes it for everyone.
- End-to-end encrypted per viewer. A photo is uploaded once, encrypted; its key only travels inside those encrypted copies. Statuses are kept (encrypted) until they expire, so they survive a restart; photos are downloaded into memory when viewed.
- Statuses are only accepted from people you know (a contact, someone in your groups, or an admin).

## Notices

Admins open **🔔 Notices → New notice**, write a title and text, and pick who gets it: everyone, or any mix of departments and groups. When an employee opens the app (or is already in it), the notice pops up over everything and only goes away when they click **OK**. Several unread notices show one after another.

Everyone has a **🔔 Notices** list with every past notice. Admins see **Read by X of Y** on each notice they sent, and can tap it to see who clicked OK (and when) and who hasn't yet.

Notices are end-to-end encrypted per person like announcements, so the server can't read them. Unlike chat messages they are kept (text only, no files) in the device's encrypted store, so the list survives restarts. A notice reaches people who have logged in at least once; anyone offline gets it the next time they open the app.

## Roadmap ideas
- Encrypted view-once images (in memory, never saved)
- Sender Keys for large groups (groups now encrypt one copy per member)
- Linked devices
