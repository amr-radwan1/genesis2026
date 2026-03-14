import { initWhisper, initWhisperVad } from 'whisper.rn';
import type { WhisperContext, WhisperVadContext, VadSegment } from 'whisper.rn';
import * as FileSystem from 'expo-file-system/legacy';

// Model URLs from Hugging Face
const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const VAD_MODEL_URL =
  'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin';

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
  // Delete any previously cached bad VAD model file before re-downloading
  try {
    const vadInfo = await FileSystem.getInfoAsync(VAD_MODEL_PATH);
    if (vadInfo.exists && vadInfo.size && vadInfo.size < 1000000) {
      await FileSystem.deleteAsync(VAD_MODEL_PATH, { idempotent: true });
    }
  } catch { /* ignore */ }
  await downloadModelIfNeeded(VAD_MODEL_URL, VAD_MODEL_PATH, 'VAD model', onProgress);
}

/**
 * Transcribe an audio file fully on-device using Whisper tiny.
 *
 * Flow:
 * 1. Convert to 16kHz mono WAV (required by whisper.cpp).
 * 2. Use Silero VAD to detect speech segments (skipping silence).
 * 3. Transcribe the audio with Whisper tiny.
 * 4. Return the combined text.
 */
export async function transcribeAudio(
  fileUri: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  let whisperContext: WhisperContext | null = null;
  let vadContext: WhisperVadContext | null = null;

  try {
    console.log('[Whisper] Starting transcription for:', fileUri);

    // Step 1: Ensure models are available
    onProgress?.('Checking models...', 10);
    await ensureModelsDownloaded(onProgress);

    // Step 2: Try VAD to detect speech segments (skip silence)
    try {
      onProgress?.('Detecting speech segments (skipping silence)...', 15);
      vadContext = await initWhisperVad({
        filePath: VAD_MODEL_PATH,
        nThreads: 4,
      });

      const speechSegments: VadSegment[] = await vadContext.detectSpeech(fileUri, {
        threshold: 0.2,
        minSpeechDurationMs: 250,
        minSilenceDurationMs: 2000,
        maxSpeechDurationS: 300,
        speechPadMs: 500,
      });

      if (speechSegments.length === 0) {
        console.log('[Whisper] VAD found 0 speech segments');
        onProgress?.('VAD found no speech segments — will transcribe full audio anyway...', 20);
      } else {
        const totalSpeechSeconds = speechSegments.reduce(
          (acc: number, seg: VadSegment) => acc + (seg.t1 - seg.t0),
          0,
        );
        console.log(`[Whisper] VAD found ${speechSegments.length} segments, ${Math.round(totalSpeechSeconds)}s of speech`);
        speechSegments.forEach((seg, i) => {
          console.log(`[Whisper]   Segment ${i + 1}: ${seg.t0.toFixed(1)}s - ${seg.t1.toFixed(1)}s`);
        });
        onProgress?.(
          `Found ${speechSegments.length} speech segments (${Math.round(totalSpeechSeconds)}s of speech)`,
          20,
        );
      }
    } catch (vadError) {
      console.warn('VAD failed, transcribing full audio without silence skipping:', vadError);
      onProgress?.('VAD unavailable — transcribing full audio...', 20);
    }

    // Step 3: Initialize Whisper and transcribe the file
    onProgress?.('Loading Whisper model...', 25);
    whisperContext = await initWhisper({
      filePath: WHISPER_MODEL_PATH,
    });

    onProgress?.('Transcribing audio...', 30);
    const { promise } = whisperContext.transcribe(fileUri, {
      language: 'en',
      maxLen: 0,
      maxThreads: 4,
      onProgress: (progress: number) => {
        const mappedProgress = 30 + Math.round(progress * 0.7);
        onProgress?.(`Transcribing... ${progress}%`, mappedProgress);
      },
    });

    const transcribeResult = await promise;
    console.log(`[Whisper] Transcription complete!`);
    console.log(`[Whisper] Result length: ${transcribeResult.result?.length ?? 0} chars`);
    console.log(`[Whisper] Segments: ${transcribeResult.segments?.length ?? 0}`);
    if (transcribeResult.segments?.length > 0) {
      const lastSeg = transcribeResult.segments[transcribeResult.segments.length - 1];
      console.log(`[Whisper] Last segment ends at: ${lastSeg.t1}ms`);
    }
    console.log(`[Whisper] isAborted: ${transcribeResult.isAborted}`);
    onProgress?.('Transcription complete!', 100);
    return transcribeResult.result || 'No transcription result.';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Transcription failed: ${message}`);
  } finally {
    if (vadContext) {
      await vadContext.release().catch(() => { });
    }
    if (whisperContext) {
      await whisperContext.release().catch(() => { });
    }
  }
}
