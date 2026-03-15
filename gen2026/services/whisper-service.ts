import * as FileSystem from 'expo-file-system/legacy';
import { PermissionsAndroid, Platform } from 'react-native';

import { startBackgroundRecordingService, stopBackgroundRecordingService } from './background-service';
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

// --- Base64 & WAV Chunking Utilities ---

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const len = base64.length;
  let bufferLength = len * 0.75;
  if (base64[len - 1] === '=') bufferLength--;
  if (base64[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = BASE64_LOOKUP[base64.charCodeAt(i)];
    const encoded2 = BASE64_LOOKUP[base64.charCodeAt(i + 1)];
    const encoded3 = BASE64_LOOKUP[base64.charCodeAt(i + 2)];
    const encoded4 = BASE64_LOOKUP[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (encoded3 !== undefined && encoded3 !== 0 || base64[i + 2] !== '=') {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (encoded4 !== undefined && encoded4 !== 0 || base64[i + 3] !== '=') {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    const enc1 = b1 >> 2;
    const enc2 = ((b1 & 3) << 4) | (b2 >> 4);
    const enc3 = ((b2 & 15) << 2) | (b3 >> 6);
    const enc4 = b3 & 63;

    base64 += BASE64_CHARS[enc1] + BASE64_CHARS[enc2];
    if (i + 1 < len) {
      base64 += BASE64_CHARS[enc3];
    } else {
      base64 += '=';
    }
    if (i + 2 < len) {
      base64 += BASE64_CHARS[enc4];
    } else {
      base64 += '=';
    }
  }
  return base64;
}

export type WavFormatInfo = {
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
};

/**
 * Parses the first 1KB of the WAV file to extract format details and the data chunk offset.
 */
async function getWavDataInfo(fileUri: string): Promise<WavFormatInfo> {
  const headerBase64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: 'base64',
    position: 0,
    length: 1024,
  });

  const h = base64ToUint8Array(headerBase64);
  const view = new DataView(h.buffer, h.byteOffset, h.byteLength);

  const formatInfo: Partial<WavFormatInfo> = {};
  let offset = 12; // Skip RIFF header

  while (offset < h.length) {
    const chunkId =
      String.fromCharCode(h[offset]) +
      String.fromCharCode(h[offset + 1]) +
      String.fromCharCode(h[offset + 2]) +
      String.fromCharCode(h[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      formatInfo.numChannels = view.getUint16(offset + 10, true);
      formatInfo.sampleRate = view.getUint32(offset + 12, true);
      formatInfo.byteRate = view.getUint32(offset + 16, true);
      formatInfo.blockAlign = view.getUint16(offset + 20, true);
      formatInfo.bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      formatInfo.dataOffset = offset + 8;
      formatInfo.dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (formatInfo.dataOffset === undefined) {
    throw new Error('Not a valid WAV file or no data chunk found within the first 1KB.');
  }

  return formatInfo as WavFormatInfo;
}

/**
 * Creates an in-memory properly aligned WAV header for the given PCM chunk.
 */
function createWavHeaderForChunk(chunkByteLength: number, info: WavFormatInfo): Uint8Array {
  const headerBytes = 44;
  const buffer = new Uint8Array(headerBytes);
  const view = new DataView(buffer.buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      buffer[offset + i] = str.charCodeAt(i);
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + chunkByteLength, true); // ChunkSize
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, info.numChannels, true);
  view.setUint32(24, info.sampleRate, true);
  view.setUint32(28, info.byteRate, true);
  view.setUint16(32, info.blockAlign, true);
  view.setUint16(34, info.bitsPerSample, true);

  writeString(36, 'data');
  view.setUint32(40, chunkByteLength, true); // Subchunk2Size

  return buffer;
}

/**
 * Resamples 16-bit PCM bytes to 16000 Hz Mono, as required by Whisper & Silero VAD natively.
 * Uses a fast nearest-neighbor strategy suitable for JS layer.
 */
function resampleTo16kHzMono(
  pcmBytes: Uint8Array,
  numChannels: number,
  sampleRate: number,
  bitsPerSample: number
): Uint8Array {
  if (numChannels === 1 && sampleRate === 16000 && bitsPerSample === 16) {
    return pcmBytes;
  }

  if (bitsPerSample !== 16) {
    console.warn("[WhisperService] Non-16-bit audio detected. Resampling might be distorted.");
    return pcmBytes;
  }

  // Convert to Int16 array (platform native endianness, almost always Little-Endian matching WAV)
  const pcm16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const targetSampleRate = 16000;
  const numFrames = Math.floor(pcm16.length / numChannels);
  const targetLength = Math.floor(numFrames * (targetSampleRate / sampleRate));

  const resampled16 = new Int16Array(targetLength);
  
  if (numChannels === 1) {
    for (let i = 0; i < targetLength; i++) {
        const srcIndex = Math.floor(i * sampleRate / targetSampleRate);
        resampled16[i] = pcm16[srcIndex];
    }
  } else if (numChannels === 2) {
    for (let i = 0; i < targetLength; i++) {
        const srcIndex = Math.floor(i * sampleRate / targetSampleRate) * 2;
        // Average L and R
        resampled16[i] = (pcm16[srcIndex] + pcm16[srcIndex + 1]) / 2;
    }
  } else {
    for (let i = 0; i < targetLength; i++) {
        const srcIndex = Math.floor(i * sampleRate / targetSampleRate) * numChannels;
        resampled16[i] = pcm16[srcIndex];
    }
  }

  return new Uint8Array(resampled16.buffer);
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
/**
 * Transcribe an audio file fully on-device using Whisper tiny.
 * Now supports large files by slicing the WAV dynamically.
 */
export async function transcribeAudio(
  fileUri: string,
  fileName?: string,
  onProgress?: ProgressCallback,
  onUpdate?: (partialText: string) => void,
): Promise<string> {
  const whisper = getWhisperModule();
  let whisperContext: Awaited<ReturnType<WhisperModule['initWhisper']>> | null = null;
  let vadContext: Awaited<ReturnType<WhisperModule['initWhisperVad']>> | null = null;

  try {
    assertSupportedAudioInput(fileUri, fileName);

    // Step 1: Ensure models are available
    onProgress?.('Checking models...', 0);
    await ensureModelsDownloaded(onProgress);

    // Step 2: Slice file logic
    onProgress?.('Reading WAV metadata...', 10);
    const wavInfo = await getWavDataInfo(fileUri);
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const actualFileSize = fileInfo.exists ? (fileInfo.size ?? 0) : 0;

    // Recorders sometimes write 0 or 0xFFFFFFFF for data length if they crash or stream
    const dataMaxLen = Math.max(0, actualFileSize - wavInfo.dataOffset);
    let dataLength = wavInfo.dataLength;
    if (dataLength <= 0 || dataLength > dataMaxLen) {
      dataLength = dataMaxLen;
    }

    // Standard chunk size: approx 3MB
    const MAX_CHUNK_BYTES = 1024 * 1024 * 3;
    let bytesPerChunk = Math.floor(MAX_CHUNK_BYTES / wavInfo.blockAlign) * wavInfo.blockAlign;

    const totalChunks = Math.ceil(dataLength / bytesPerChunk);
    console.log(`[WhisperService] File size: ${actualFileSize}, Data offset: ${wavInfo.dataOffset}, Data length: ${dataLength}`);
    console.log(`[WhisperService] Split into ${totalChunks} chunks of max size ${bytesPerChunk} bytes`);
    onProgress?.(`Split into ${totalChunks} chunks`, 15);

    // Step 3: Initialize VAD & Whisper
    onProgress?.('Loading VAD and Whisper models...', 20);
    try {
      vadContext = await whisper.initWhisperVad({
        filePath: VAD_MODEL_PATH,
        useGpu: false,
        nThreads: 4, // 4 threads per model is good for Android CPU
      });
    } catch (e) {
      console.warn('VAD failed to load', e);
    }

    whisperContext = await whisper.initWhisper({
      filePath: WHISPER_MODEL_PATH,
    });

    onProgress?.('Transcribing...', 30);

    let completeTranscript = '';

    // Process chunk by chunk
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const positionBeforeData = chunkIdx * bytesPerChunk;
      const lengthToRead = Math.min(bytesPerChunk, dataLength - positionBeforeData);

      if (lengthToRead <= 0) break;

      // Read just this chunk's PCM byte data in Base64
      const pcmBase64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: 'base64',
        position: wavInfo.dataOffset + positionBeforeData,
        length: lengthToRead,
      });

      if (!pcmBase64) {
        console.log(`[WhisperService] Chunk ${chunkIdx}: Read empty base64 string. Breaking.`);
        break;
      }

      const pcmBytes = base64ToUint8Array(pcmBase64);
      console.log(`[WhisperService] Chunk ${chunkIdx}: Read ${pcmBytes.byteLength} bytes of PCM data`);

      // whisper.rn's AudioUtils.java incorrectly cuts 44 SHORTS (88 bytes) instead of bytes.
      // If the WAV is < 88 bytes total, it throws "IllegalArgumentException: 44 > X".
      // Ensure we have at least 44 bytes of PCM to avoid this.
      if (pcmBytes.byteLength < 44) {
        console.log(`[WhisperService] Chunk ${chunkIdx}: Less than 44 bytes (${pcmBytes.byteLength}). Skipping.`);
        break;
      }
      // Resample to strictly 16kHz Mono before feeding to Whisper!
      const resampledBytes = resampleTo16kHzMono(
        pcmBytes,
        wavInfo.numChannels,
        wavInfo.sampleRate,
        wavInfo.bitsPerSample
      );

      const targetWavInfo: WavFormatInfo = {
        numChannels: 1,
        sampleRate: 16000,
        byteRate: 32000,
        blockAlign: 2,
        bitsPerSample: 16,
        dataOffset: 44, // 16kHz headers are 44 bytes
        dataLength: resampledBytes.byteLength
      };

      const headerBytes = createWavHeaderForChunk(resampledBytes.byteLength, targetWavInfo);

      // Combine header and PCM bytes directly via Uint8Array and encode back to base64
      const fullWavBytes = new Uint8Array(headerBytes.byteLength + resampledBytes.byteLength);
      fullWavBytes.set(headerBytes, 0);
      fullWavBytes.set(resampledBytes, headerBytes.byteLength);

      const chunkBase64 = uint8ArrayToBase64(fullWavBytes);

      // Write valid WAV chunk to temp file
      const chunkFileName = `temp_chunk_${chunkIdx}.wav`;
      const chunkFileUri = `${FileSystem.cacheDirectory}${chunkFileName}`;

      console.log(`[WhisperService] Chunk ${chunkIdx}: Writing ${fullWavBytes.byteLength} bytes to ${chunkFileUri}`);

      await FileSystem.writeAsStringAsync(chunkFileUri, chunkBase64, {
        encoding: 'base64',
      });

      try {
        let hasSpeech = true;

        if (vadContext) {
          try {
            const speechSegments = await vadContext.detectSpeech(chunkFileUri, {
              threshold: 0.2,
              minSpeechDurationMs: 500,
              minSilenceDurationMs: 1000,
              maxSpeechDurationS: 300,
              speechPadMs: 200,
            });
            hasSpeech = speechSegments.length > 0;
            console.log(`[WhisperService] Chunk ${chunkIdx}: VAD detected ${speechSegments.length} speech segments, hasSpeech = ${hasSpeech}`);
          } catch (vadError) {
            console.log(`[WhisperService] Chunk ${chunkIdx}: VAD failed, falling back to all-speech:`, vadError);
          }
        }

        if (hasSpeech) {
          console.log(`[WhisperService] Chunk ${chunkIdx}: Transcribing...`);
          const { promise } = whisperContext.transcribe(chunkFileUri, {
            language: 'en',
            maxLen: 1,
            tokenTimestamps: true,
          });

          const transcribeResult = await promise;
          const text = transcribeResult.result?.trim() ?? '';
          console.log(`[WhisperService] Chunk ${chunkIdx}: Result length = ${text.length}`);
          if (text) {
            completeTranscript += (completeTranscript ? '\n\n' : '') + text;
            onUpdate?.(completeTranscript);
          } else {
            console.log(`[WhisperService] Chunk ${chunkIdx}: Result was empty after trim()`);
          }
        } else {
          console.log(`[WhisperService] Chunk ${chunkIdx}: Skipped transcription due to VAD`);
        }

      } finally {
        await FileSystem.deleteAsync(chunkFileUri, { idempotent: true });
      }

      // Progress reporting
      const chunkProgress = Math.round((chunkIdx + 1) / totalChunks * 70);
      onProgress?.(`Transcribing... ${30 + chunkProgress}%`, 30 + chunkProgress);
      // Give the event loop a tick
      await sleep(10);
    }

    onProgress?.('Transcription complete!', 100);
    return completeTranscript || 'No transcription result.';
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
      message: 'EchoMind needs microphone access for live Whisper transcription.',
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

  let resolveEnd: () => void = () => { };
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
    realtimeAudioSec: 30,
    realtimeAudioSliceSec: 30,
    realtimeAudioMinSec: 2,
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

  await stopBackgroundRecordingService();

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

  await startBackgroundRecordingService();
  await beginLiveSession(controller);

  return {
    stop: async () => {
      await stopLiveTranscription();
    },
  };
}
