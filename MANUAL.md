# CellMate: doing it yourself

Step by step: change the code, test it, save it to GitHub, update the server, and make a new APK.
Run every command in **PowerShell** inside the project folder:

```powershell
cd C:\Users\princ\OneDrive\Desktop\Signal\meetme
```

## What each change needs

| You changed… | Do these steps |
|---|---|
| Server (`apps/server`) | 1 → 2 → 3 → 4 |
| Phone app (`apps/mobile`) | 1 → 2 → 3 → 5 → 6 |
| Desktop app (`apps/desktop`) | 1 → 2 → 3 → 5 → 7 |
| Shared code (`packages/core`) | all of them: server **and** apps use it |

---

## 1. Try it while you work

```powershell
npm run server      # local server on http://localhost:8080
npm run desktop     # desktop app (uses the local server)
npm run android     # phone app on a phone plugged in with USB debugging on
```

Stop with `Ctrl + C`.

## 2. Test before saving

```powershell
npm run typecheck
npm test
```

Both must end with no errors (tests: `fail 0`). If something fails, fix it first.

## 3. Save to GitHub (both repos!)

There are **two** GitHub repos. The server downloads from `Signal-Android-`, so always push to both:

```powershell
git status                     # see what changed
git add -A
git commit -m "Say what you changed"
git push origin main
git push signal-android main
```

Never commit passwords, `.env`, `google-services.json` or anything from `C:\Users\princ\meetme-release-keys`.
(`git status` should never show them. If it does, stop and don't commit.)

## 4. Update the live server

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1
```

It ends with `Server is live`. People's apps reconnect by themselves within a few seconds.

Useful server commands (`ssh ubuntu@80.225.252.210` first):

```bash
cd ~/meetme/infra
sudo docker compose ps                      # is everything running?
sudo docker compose logs --tail 100 server  # server log (errors show here)
sudo docker compose restart server          # restart only the server
ls backups/                                 # nightly database backups (kept 14 days)
```

## 5. Raise the version number (apps only)

Phones only install an update if its number is higher. Before every new APK:

- `apps/mobile/android/app/build.gradle`:
  - `versionCode 3` → `4` (always +1, a whole number)
  - `versionName "1.1.1"` → `"1.1.2"` (what people see)
- `apps/desktop/package.json`: `"version": "1.1.1"` → `"1.1.2"`

Then save to GitHub again (step 3).

## 6. Make the APK

### On your PC (free, works now)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

- It takes 10 to 20 minutes. **Close Chrome and other big programs first**, because the build needs a lot of memory.
- When it finishes you get `CellMate-<version>.apk` on your **Desktop**.
- The APK works on almost every phone (arm64). For very old phones, add `-AllPhones` (slower).
- It's signed with your release key, so it installs **as an update** over the old app.

Send it to the phone (OneDrive app → Desktop, USB cable, or WhatsApp to yourself **as a document**),
open it and tap **Install / Update**.

### On GitHub (needs working billing or free minutes)

A version tag starts the Android and Windows/Linux builds on GitHub:

```powershell
git tag v1.1.2
git push origin v1.1.2
git push signal-android v1.1.2
```

Then open GitHub → **Actions** and wait for a green ✓. Download the APK under **Artifacts**.
Build files are deleted after 7 days, because GitHub's free storage is small.
If the job says *"payments have failed / spending limit"*, fix it under GitHub → Settings → Billing and plans, or wait until the 1st of the month.

## 7. Desktop app (Windows installer)

```powershell
npm run dist:win -w @meetme/desktop
```

The installer is created in `apps\desktop\dist\`.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `git push` is rejected | `git pull --rebase origin main`, then push again |
| APK build: `still dirty after 100 tries` | You built inside OneDrive. Use `scripts\build-apk.ps1`, which builds in `C:\dev\meetme`. |
| APK build stops / PC freezes | Not enough memory: close programs and run it again |
| APK build: odd error after adding a package | Delete `C:\dev\meetme` and run the script again (the first run is slower) |
| Phone says "App not installed" | The versionCode isn't higher, or the APK was signed with a different key |
| Deploy: `Permission denied (publickey)` | Use the PC with your SSH key (`C:\Users\princ\.ssh\id_ed25519`) |
| App can't connect after deploy | `sudo docker compose logs --tail 100 server` on the server and read the error |

## Never do this

- **Never** delete or recreate `upload.jks`. Without it you can never update the app again. Keep 2 backups.
- **Never** share `fcm-service-account.json`, `infra/.env` or the Oracle secret keys.
- **Never** delete the Oracle VM or its database volume without a fresh backup.

## Owner page

https://chat.gosite.lol/super: create, approve, suspend or rename companies and move people between companies.
Sign in with your owner ID + password.
