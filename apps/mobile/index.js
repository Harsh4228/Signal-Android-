/**
 * @format
 */

// Must be first: provides a cryptographically secure crypto.getRandomValues (native CSPRNG).
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Wake-up pushes carry no content: the system shows "New message" / "Incoming call" by itself, so the
// background handler has nothing to do. (It must exist, or Firebase logs a warning on Android.)
try {
  const { getApp } = require('@react-native-firebase/app');
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
  setBackgroundMessageHandler(getMessaging(getApp()), async () => {});
} catch {
  // Firebase not configured in this build.
}

AppRegistry.registerComponent(appName, () => App);
