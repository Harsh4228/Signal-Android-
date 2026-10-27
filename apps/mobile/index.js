/**
 * @format
 */

// Must be first: provides a cryptographically secure crypto.getRandomValues (native CSPRNG).
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Wake-up pushes carry no content. "New message" is shown by the system itself. An incoming call is a
// silent push: the app wakes up, shows the phone's call screen (Answer / Decline) and connects to learn who
// is calling (src/callNotify.ts).
try {
  const { getApp } = require('@react-native-firebase/app');
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
  setBackgroundMessageHandler(getMessaging(getApp()), async (msg) => {
    if (msg?.data?.t === 'call') await require('./src/callNotify').onCallPush();
  });
} catch {
  // Firebase not configured in this build.
}

AppRegistry.registerComponent(appName, () => App);
