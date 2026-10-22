// Browser build of the desktop UI, for local testing only. With no Electron preload, messenger.ts falls back
// to a per-tab sessionStorage store (see browserStore.ts): open one tab per user.
import '../src/renderer/src/main';
