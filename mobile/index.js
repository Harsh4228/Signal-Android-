/**
 * @format
 */

// Must be first: provides a cryptographically secure crypto.getRandomValues (native CSPRNG).
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
