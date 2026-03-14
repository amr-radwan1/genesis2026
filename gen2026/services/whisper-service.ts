import { initWhisper, initWhisperVad } from 'whisper.rn';
import type { WhisperContext, WhisperVadContext, VadSegment } from 'whisper.rn';
import * as FileSystem from 'expo-file-system/legacy';

// Model URLs from Hugging Face
const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const VAD_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-silero-v6.2.0.bin';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
const WHISPER_MODEL_PATH = `${MODELS_DIR}ggml-tiny.bin`;
const VAD_MODEL_PATH = `${MODELS_DIR}ggml-silero-v6.2.0.bin`;

type ProgressCallback = (message: string, percent: number) => void;


async function downloadModelIfNeeded(
  url: string,
  localPath: string,
  label: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const fileInfo = await FileSystem.getInfoAsync(localPath);
  if (fileInfo.exists) {
    onProgress?.(`${label} already cached`, 100);
    return;
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
  onProgress?.(`${label} downloaded`, 100);
}

/**
 * Ensure both model files (Whisper tiny + Silero VAD) are downloaded.
 */
export async function ensureModelsDownloaded(onProgress?: ProgressCallback): Promise<void> {
  await downloadModelIfNeeded(WHISPER_MODEL_URL, WHISPER_MODEL_PATH, 'Whisper tiny model', onProgress);
  await downloadModelIfNeeded(VAD_MODEL_URL, VAD_MODEL_PATH, 'VAD model', onProgress);
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
  onProgress?: ProgressCallback,
): Promise<string> {
  let whisperContext: WhisperContext | null = null;
  let vadContext: WhisperVadContext | null = null;

  try {
    // Step 1: Ensure models are available
    onProgress?.('Checking models...', 0);
    await ensureModelsDownloaded(onProgress);

    // Step 2: Detect speech segments with VAD (skip silence)
    onProgress?.('Detecting speech segments (skipping silence)...', 10);
    vadContext = await initWhisperVad({
      filePath: VAD_MODEL_PATH,
      nThreads: 4,
    });

    const speechSegments: VadSegment[] = await vadContext.detectSpeech(fileUri, {
      threshold: 0.5,
      minSpeechDurationMs: 500,
      minSilenceDurationMs: 1000,
      maxSpeechDurationS: 300, // 5 minute max segments
      speechPadMs: 200,
    });

    if (speechSegments.length === 0) {
      onProgress?.('No speech detected in audio', 100);
      return 'No speech detected in the audio file.';
    }

    const totalSpeechSeconds = speechSegments.reduce(
      (acc: number, seg: VadSegment) => acc + (seg.t1 - seg.t0),
      0,
    );
    onProgress?.(
      `Found ${speechSegments.length} speech segments (${Math.round(totalSpeechSeconds)}s of speech)`,
      20,
    );

    // Step 3: Initialize Whisper and transcribe
    onProgress?.('Loading Whisper model...', 25);
    whisperContext = await initWhisper({
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
