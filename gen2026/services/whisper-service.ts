import * as FileSystem from 'expo-file-system/legacy';
import { PermissionsAndroid, Platform } from 'react-native';

import { assertNativeInferenceAvailable } from '@/services/native-runtime';

type WhisperModule = {
  initWhisper: (options: { filePath: string }) => Promise<{
    transcribe: (
      filePath: string,
      options: {
        language?: string;
        maxLen?: number;
        tokenTimestamps?: boolean;
        onProgress?: (progress: number) => void;
      },
    ) => {
      promise: Promise<{ result?: string }>;
      stop: () => Promise<void>;
    };
    transcribeRealtime: (options?: {
      language?: string;
      maxLen?: number;
      tokenTimestamps?: boolean;
      realtimeAudioSec?: number;
      realtimeAudioSliceSec?: number;
      realtimeAudioMinSec?: number;
      useVad?: boolean;
      vadMs?: number;
      vadThold?: number;
      vadFreqThold?: number;
    }) => Promise<{
      stop: () => Promise<void>;
      subscribe: (
        callback: (event: {
          isCapturing: boolean;
          processTime: number;
          recordingTime: number;
          data?: { result?: string };
          error?: string;
        }) => void,
      ) => void;
    }>;
    release: () => Promise<void>;
  }>;
  initWhisperVad: (options: {
    filePath: string;
    useGpu?: boolean;
    nThreads?: number;
  }) => Promise<{
    detectSpeech: (
      filePath: string,
      options: {
        threshold?: number;
        minSpeechDurationMs?: number;
        minSilenceDurationMs?: number;
        maxSpeechDurationS?: number;
        speechPadMs?: number;
      },
    ) => Promise<Array<{ t0: number; t1: number }>>;
    release: () => Promise<void>;
  }>;
  releaseAllWhisper?: () => Promise<void>;
};

type LiveTranscriptionHandle = {
  stop: () => Promise<void>;
};

type LiveTranscriptionCallbacks = {
  onUpdate: (message: string) => void;
  onStatus?: (message: string) => void;
};

type LiveSession = {
  context: Awaited<ReturnType<WhisperModule['initWhisper']>>;
  stop: () => Promise<void>;
  endPromise: Promise<void>;
  resolveEnd: () => void;
  currentDraft: string;
  released: boolean;
  stopping: boolean;
};

type LiveController = {
  active: boolean;
  callbacks: LiveTranscriptionCallbacks;
  segments: string[];
  session: LiveSession | null;
};

// Model URLs from Hugging Face
const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const VAD_MODEL_URL =
  'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
const WHISPER_MODEL_PATH = `${MODELS_DIR}ggml-tiny.bin`;
const VAD_MODEL_PATH = `${MODELS_DIR}ggml-silero-v6.2.0.bin`;
const MIN_WHISPER_MODEL_BYTES = 1_000_000;
const MIN_VAD_MODEL_BYTES = 100_000;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['wav', 'wave']);

type ProgressCallback = (message: string, percent: number) => void;

let activeLiveController: LiveController | null = null;

function getWhisperModule(): WhisperModule {
  assertNativeInferenceAvailable();

  try {
    return require('whisper.rn/src/index') as WhisperModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown native load error';
    throw new Error(`Whisper native module is unavailable: ${message}`);
  }
}

function getFileExtension(pathOrName: string | null | undefined) {
  if (!pathOrName) {
    return null;
  }

  const cleaned = pathOrName.split('?')[0].split('#')[0];
  const lastSegment = cleaned.split('/').pop() ?? cleaned;
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex === -1) {
    return null;
  }

  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function assertSupportedAudioInput(fileUri: string, fileName?: string) {
  const extension = getFileExtension(fileName) ?? getFileExtension(fileUri);
  if (extension && !SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported audio format ".${extension}". On Android, this Whisper build currently expects a WAV file.`,
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildLiveTranscript(controller: LiveController) {
  return [...controller.segments, controller.session?.currentDraft ?? '']
    .filter(Boolean)
    .join('\n\n');
}

async function downloadModelIfNeeded(
  url: string,
  localPath: string,
  label: string,
  minBytes: number,
  onProgress?: ProgressCallback,
): Promise<void> {
  const fileInfo = await FileSystem.getInfoAsync(localPath);
  if (fileInfo.exists && (fileInfo.size ?? 0) >= minBytes) {
    onProgress?.(`${label} already cached`, 100);
    return;
  }

  if (fileInfo.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }

  onProgress?.(`Downloading ${label}...`, 0);

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    localPath,
    {},
    (downloadProgress) => {
      const pct = Math.round(
        (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100,
      );
      onProgress?.(`Downloading ${label}... ${pct}%`, pct);
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Failed to download ${label}`);
  }

  const downloadedInfo = await FileSystem.getInfoAsync(localPath);
  if (!downloadedInfo.exists || (downloadedInfo.size ?? 0) < minBytes) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
    throw new Error(`${label} download looks invalid. Please retry the download.`);
  }

  onProgress?.(`${label} downloaded`, 100);
}

/**
 * Ensure both model files (Whisper tiny + Silero VAD) are downloaded.
 */
export async function ensureModelsDownloaded(onProgress?: ProgressCallback): Promise<void> {
  await downloadModelIfNeeded(
    WHISPER_MODEL_URL,
    WHISPER_MODEL_PATH,
    'Whisper tiny model',
    MIN_WHISPER_MODEL_BYTES,
    onProgress,
  );
  await downloadModelIfNeeded(
    VAD_MODEL_URL,
    VAD_MODEL_PATH,
    'VAD model',
    MIN_VAD_MODEL_BYTES,
    onProgress,
  );
}

export async function getWhisperModelStatus() {
  const [whisperInfo, vadInfo] = await Promise.all([
    FileSystem.getInfoAsync(WHISPER_MODEL_PATH),
    FileSystem.getInfoAsync(VAD_MODEL_PATH),
  ]);

  return {
    ready: whisperInfo.exists && vadInfo.exists,
    whisperPath: WHISPER_MODEL_PATH,
    vadPath: VAD_MODEL_PATH,
  };
}

/**
 * Transcribe an audio file fully on-device using Whisper tiny.
 *
 * Flow:
 * 1. Use Silero VAD to detect speech segments (skipping silence).
 * 2. Transcribe the audio with Whisper tiny.
 * 3. Return the combined text.
 */
export async function transcribeAudio(
  fileUri: string,
  fileName?: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const whisper = getWhisperModule();
  let whisperContext: Awaited<ReturnType<WhisperModule['initWhisper']>> | null = null;
  let vadContext: Awaited<ReturnType<WhisperModule['initWhisperVad']>> | null = null;

  try {
    assertSupportedAudioInput(fileUri, fileName);

    // Step 1: Ensure models are available
    onProgress?.('Checking models...', 0);
    await ensureModelsDownloaded(onProgress);

    // Step 2: Detect speech segments with VAD (skip silence)
    try {
      onProgress?.('Detecting speech segments (skipping silence)...', 10);
      vadContext = await whisper.initWhisperVad({
        filePath: VAD_MODEL_PATH,
        useGpu: false,
        nThreads: 4,
      });

      const speechSegments = await vadContext.detectSpeech(fileUri, {
        threshold: 0.5,
        minSpeechDurationMs: 500,
        minSilenceDurationMs: 1000,
        maxSpeechDurationS: 300,
        speechPadMs: 200,
      });

      if (speechSegments.length === 0) {
        onProgress?.('VAD found no speech, transcribing the full WAV anyway...', 20);
      } else {
        const totalSpeechSeconds = speechSegments.reduce(
          (acc: number, seg: { t0: number; t1: number }) => acc + (seg.t1 - seg.t0),
          0,
        );
        onProgress?.(
          `Found ${speechSegments.length} speech segments (${Math.round(totalSpeechSeconds)}s of speech)`,
          20,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown VAD error';
      onProgress?.(`VAD unavailable, transcribing full WAV instead. ${message}`, 20);
    }

    // Step 3: Initialize Whisper and transcribe
    onProgress?.('Loading Whisper model...', 25);
    whisperContext = await whisper.initWhisper({
      filePath: WHISPER_MODEL_PATH,
    });

    onProgress?.('Transcribing audio...', 30);
    const { promise } = whisperContext.transcribe(fileUri, {
      language: 'en',
      maxLen: 1, // return text per sentence
      tokenTimestamps: true,
      onProgress: (progress: number) => {
        const mappedProgress = 30 + Math.round(progress * 0.7);
        onProgress?.(`Transcribing... ${progress}%`, mappedProgress);
      },
    });

    const transcribeResult = await promise;
    onProgress?.('Transcription complete!', 100);
    return transcribeResult.result || 'No transcription result.';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Transcription failed: ${message}`);
  } finally {
    // Clean up contexts
    if (vadContext) {
      await vadContext.release().catch(() => { });
    }
    if (whisperContext) {
      await whisperContext.release().catch(() => { });
    }
  }
}

async function ensureMicrophonePermission() {
  if (Platform.OS !== 'android') {
    return;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access required',
      message: 'Genesis 2026 needs microphone access for live Whisper transcription.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    },
  );

  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone permission was denied.');
  }
}

async function releaseLiveSession(
  whisper: WhisperModule,
  session: LiveSession,
) {
  if (session.released) {
    return;
  }

  session.released = true;
  await Promise.race([session.endPromise, sleep(2500)]);
  await sleep(250);
  await session.context.release().catch(() => undefined);
  await whisper.releaseAllWhisper?.().catch(() => undefined);
}

async function beginLiveSession(controller: LiveController) {
  if (!controller.active || activeLiveController !== controller) {
    return;
  }

  const whisper = getWhisperModule();
  controller.callbacks.onStatus?.('Loading live microphone session...');

  const context = await whisper.initWhisper({
    filePath: WHISPER_MODEL_PATH,
  });

  let resolveEnd: () => void = () => {};
  const endPromise = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });

  const session: LiveSession = {
    context,
    stop: async () => undefined,
    endPromise,
    resolveEnd,
    currentDraft: '',
    released: false,
    stopping: false,
  };

  controller.session = session;
  const realtime = await context.transcribeRealtime({
    language: 'en',
    maxLen: 1,
    tokenTimestamps: true,
    useVad: false,
    realtimeAudioSec: 12,
    realtimeAudioSliceSec: 12,
    realtimeAudioMinSec: 1.5,
  });

  session.stop = async () => {
    if (session.stopping) {
      return;
    }
    session.stopping = true;
    await realtime.stop().catch(() => undefined);
  };

  controller.callbacks.onStatus?.('Listening live...');

  realtime.subscribe((event) => {
    if (controller.session !== session) {
      return;
    }

    if (event.error) {
      controller.callbacks.onStatus?.(`Live transcription error: ${event.error}`);
      controller.active = false;
      controller.session = null;
      session.resolveEnd();
      releaseLiveSession(whisper, session).catch(() => undefined);
      if (activeLiveController === controller) {
        activeLiveController = null;
      }
      return;
    }

    const text = event.data?.result?.trim() ?? '';
    if (text) {
      session.currentDraft = text;
      controller.callbacks.onUpdate(buildLiveTranscript(controller));
    }

    if (!event.isCapturing) {
      if (session.currentDraft) {
        const lastCommitted = controller.segments[controller.segments.length - 1];
        if (lastCommitted !== session.currentDraft) {
          controller.segments.push(session.currentDraft);
        }
        session.currentDraft = '';
      }

      controller.callbacks.onUpdate(buildLiveTranscript(controller));
      controller.session = null;
      session.resolveEnd();

      releaseLiveSession(whisper, session)
        .then(() => {
          if (controller.active && activeLiveController === controller) {
            controller.callbacks.onStatus?.('Refreshing live capture...');
            return beginLiveSession(controller);
          }

          if (activeLiveController === controller) {
            activeLiveController = null;
          }
          controller.callbacks.onStatus?.('Live transcription stopped.');
          return undefined;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Unknown live session error';
          controller.callbacks.onStatus?.(`Live transcription error: ${message}`);
          if (activeLiveController === controller) {
            activeLiveController = null;
          }
        });
    }
  });
}

export async function stopLiveTranscription() {
  const controller = activeLiveController;
  activeLiveController = null;

  if (!controller) {
    return;
  }

  controller.active = false;

  const session = controller.session;
  controller.session = null;

  if (session) {
    const whisper = getWhisperModule();
    await session.stop().catch(() => undefined);
    await releaseLiveSession(whisper, session);
  }

  controller.callbacks.onStatus?.('Live transcription stopped.');
}

export async function startLiveTranscription(
  onUpdate: (message: string) => void,
  onStatus?: (message: string) => void,
): Promise<LiveTranscriptionHandle> {
  await stopLiveTranscription();
  await ensureMicrophonePermission();
  await ensureModelsDownloaded((message) => onStatus?.(message));
  const controller: LiveController = {
    active: true,
    callbacks: {
      onUpdate,
      onStatus,
    },
    segments: [],
    session: null,
  };
  activeLiveController = controller;

  await beginLiveSession(controller);

  return {
    stop: async () => {
      await stopLiveTranscription();
    },
  };
}
