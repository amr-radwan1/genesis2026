import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { Platform } from 'react-native';

const CHANNEL_ID = 'transcription_channel';

// Required by Notifee for any foreground service
let resolveForeground: (() => void) | null = null;

if (Platform.OS === 'android') {
  notifee.registerForegroundService(() => {
    return new Promise((resolve) => {
      resolveForeground = resolve as () => void;
    });
  });
}

export async function startBackgroundRecordingService() {
  if (Platform.OS !== 'android') return;

  await notifee.requestPermission();

  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Live Transcription',
    importance: AndroidImportance.LOW,
  });

  await notifee.displayNotification({
    id: 'live_transcription_service',
    title: 'Live Transcription Active',
    body: 'Genesis 2026 is actively listening and transcribing your speech in the background.',
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      foregroundServiceTypes: [128], // AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE (128)
    },
  });
}

export async function updateBackgroundRecordingText(text: string) {
  if (Platform.OS !== 'android') return;
  
  const displayBody = text.trim() ? text : 'Genesis 2026 is actively listening and transcribing your speech in the background.';

  await notifee.displayNotification({
    id: 'live_transcription_service',
    title: 'Live Transcription Active',
    body: displayBody,
    android: {
      channelId: CHANNEL_ID,
      asForegroundService: true,
      ongoing: true,
      foregroundServiceTypes: [128],
    },
  });
}

export async function stopBackgroundRecordingService() {
  if (Platform.OS !== 'android') return;

  if (resolveForeground) {
    resolveForeground();
    resolveForeground = null;
  }
  await notifee.stopForegroundService();
}

const BackgroundService = {
  startService: startBackgroundRecordingService,
  stopService: stopBackgroundRecordingService,
  updateServiceText: updateBackgroundRecordingText,
};

export default BackgroundService;
