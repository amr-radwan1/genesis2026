import { Platform } from 'react-native';

export function getNativeInferenceStatus() {
  if (Platform.OS === 'web') {
    return {
      available: false,
      reason: 'On-device Whisper and Qwen only run in the native Android build.',
    };
  }

  return {
    available: true,
    reason: 'Native Android runtime expected.',
  };
}

export function assertNativeInferenceAvailable() {
  const status = getNativeInferenceStatus();
  if (!status.available) {
    throw new Error(status.reason);
  }
}
