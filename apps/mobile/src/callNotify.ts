import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { calls, client, startClient } from './messenger';

/**
 * Incoming calls while CellMate is in the background or closed (Android): the phone's own call screen with
 * Answer / Decline over the lock screen (native CallNotification module). In the app, CallScreen is shown instead.
 */
const Native = NativeModules.CallNotification as
  | {
      show(caller: string, video: boolean): void;
      cancel(): void;
      takePendingAction(): Promise<string | null>;
      endCallMode(): void;
    }
  | undefined;

/** This build can show the native call screen, so the server may send call wake-ups as silent data pushes. */
export const nativeCallUi = Platform.OS === 'android' && !!Native;

let shown = false;
/** "Answer" was pressed before the call itself had arrived (the app was still starting). */
let answerWhenReady = false;
let started = false;

function sync() {
  const s = calls.state;
  const background = AppState.currentState !== 'active';
  if (s.status === 'incoming' && answerWhenReady) {
    answerWhenReady = false;
    void calls.accept();
    return;
  }
  if (s.status === 'incoming' && background) {
    Native!.show(s.peer ? client.displayName(s.peer) : 'CellMate', s.video);
    shown = true;
  } else if (shown) {
    Native!.cancel();
    shown = false;
  }
  if (s.status === 'idle') Native!.endCallMode();
}

function onAction(action: string | null) {
  if (action === 'answer') {
    if (calls.state.status === 'incoming') void calls.accept();
    else answerWhenReady = true;
  } else if (action === 'decline') {
    void calls.reject();
  }
}

/** Once per app start: follow the call state and the notification buttons. */
export function setupCallNotifications() {
  if (!nativeCallUi || started) return;
  started = true;
  calls.on('change', sync);
  AppState.addEventListener('change', sync);
  new NativeEventEmitter(NativeModules.CallNotification).addListener('CallNotificationAction', (a) => onAction(String(a)));
  void Native!.takePendingAction().then(onAction);
}

/**
 * A silent "incoming call" push woke the app (it may have been closed): ring at once, then connect to learn
 * who is calling. Resolves when the ringing is over, so Android keeps the app running meanwhile.
 */
export async function onCallPush(): Promise<void> {
  if (!nativeCallUi) return;
  setupCallNotifications();
  if (calls.state.status === 'idle') {
    Native!.show('Incoming call', false);
    shown = true;
  }
  if (!(await startClient())) {
    Native!.cancel();
    return;
  }
  await new Promise<void>((done) => {
    // The call offer normally arrives within a second or two of connecting; if it never does, stop ringing.
    const noCall = setTimeout(() => {
      if (calls.state.status === 'idle') {
        Native!.cancel();
        shown = false;
        finish();
      }
    }, 15_000);
    const limit = setTimeout(finish, 60_000);
    const off = calls.on('change', (s) => {
      if (s.status !== 'incoming' && s.status !== 'idle') finish(); // answered
      else if (s.status === 'idle' && s.endReason) finish(); // missed / declined / cancelled
    });
    function finish() {
      clearTimeout(noCall);
      clearTimeout(limit);
      off();
      done();
    }
  });
}
