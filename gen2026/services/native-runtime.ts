import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getNativeInferenceStatus() {
  const executionEnvironment = Constants.executionEnvironment ?? 'unknown';

  if (Platform.OS === 'web') {
    return {
      available: false,
      reason: 'On-device Whisper and Qwen only run in the native Android build.',
    };
  }

  if (executionEnvironment === 'storeClient') {
    return {
      available: false,
      reason:
        'Expo Go cannot load whisper.rn or llama.rn. Use `npx expo prebuild` and `npx expo run:android`.',
    };
  }

  return {
    available: true,
    reason: 'Native runtime detected.',
  };
}

export function assertNativeInferenceAvailable() {
  const status = getNativeInferenceStatus();
  if (!status.available) {
    throw new Error(status.reason);
  }
}
