import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { calls, client, startClient } from './messenger';

/**
 * Incoming calls while CellMate is in the background or closed: the phone's own call screen with Answer / Decline
 * over the lock screen. Android: the native CallNotification module. iPhone: CallKit (ios/MeetMe/CallCenter.swift).
 * In the app, CallScreen is shown instead.
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

const Apple = NativeModules.ApplePush as
  | {
      showCall(name: string, video: boolean): void;
      updateCall(name: string, video: boolean): void;
      answerCall(): void;
      endCall(): void;
      takePendingAction(): Promise<string | null>;
    }
  | undefined;
const appleCalls = Platform.OS === 'ios' && !!Apple;

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
  if (appleCalls) return setupAppleCalls();
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

// ---- iPhone (CallKit) ----

/** A call is on the phone's call screen (CallKit), from a VoIP push or shown while in the background. */
let appleShown = false;
let appleWait: ReturnType<typeof setTimeout> | null = null;
let declineWhenReady = false;
/** The phone's call screen holds an answered call (no need to answer it there again). */
let appleAnswered = false;

function appleSync() {
  const s = calls.state;
  if (s.status !== 'idle' && appleWait) {
    clearTimeout(appleWait); // the call has arrived
    appleWait = null;
  }
  if (s.status === 'incoming' && declineWhenReady) {
    declineWhenReady = false;
    void calls.reject();
    return;
  }
  if (s.status === 'incoming' && answerWhenReady) {
    answerWhenReady = false;
    void calls.accept();
    return;
  }
  const name = s.peer ? client.displayName(s.peer) : 'CellMate';
  if (s.status === 'incoming') {
    if (appleShown) Apple!.updateCall(name, s.video);
    else if (AppState.currentState !== 'active') {
      Apple!.showCall(name, s.video);
      appleShown = true;
    }
  } else if (s.status === 'connecting' || s.status === 'connected') {
    // Answered in the app while the phone's call screen rang: it takes the call over (audio, lock screen).
    if (appleShown && !appleAnswered) Apple!.answerCall();
    appleAnswered = appleShown;
  } else if (s.status === 'idle' && appleShown && !appleWait) {
    Apple!.endCall();
    appleShown = false;
    appleAnswered = false;
  }
}

function appleAction(action: string | null) {
  const s = calls.state;
  if (action === 'incoming' || (action === 'answer' && s.status === 'idle')) {
    // A VoIP push rang the phone (perhaps starting the app); connect to learn who calls. No call within 15 s:
    // the caller gave up meanwhile.
    appleShown = true;
    if (appleWait) clearTimeout(appleWait);
    appleWait = setTimeout(() => {
      appleWait = null;
      if (calls.state.status === 'idle') {
        Apple!.endCall();
        appleShown = false;
      }
      answerWhenReady = false;
      declineWhenReady = false;
    }, 15_000);
    void startClient().then((ok) => {
      if (!ok) {
        Apple!.endCall();
        appleShown = false;
      } else if (client.status === 'offline') client.connect();
    });
  }
  if (action === 'answer') {
    appleAnswered = true;
    if (s.status === 'incoming') void calls.accept();
    else if (s.status === 'idle') answerWhenReady = true;
  } else if (action === 'decline') {
    appleShown = false;
    appleAnswered = false;
    answerWhenReady = false;
    if (s.status === 'incoming') void calls.reject();
    else if (s.status !== 'idle') void calls.hangup();
    else declineWhenReady = !!appleWait; // declined before the call itself arrived
  } else if ((action === 'mute' && !s.muted) || (action === 'unmute' && s.muted)) {
    calls.toggleMute();
  }
}

function setupAppleCalls() {
  if (started) return;
  started = true;
  calls.on('change', appleSync);
  AppState.addEventListener('change', appleSync);
  new NativeEventEmitter(NativeModules.ApplePush).addListener('ApplePushAction', (a) => appleAction(String(a)));
  void Apple!.takePendingAction().then(appleAction);
}
