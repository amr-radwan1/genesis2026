import * as FileSystem from 'expo-file-system/legacy';

import { assertNativeInferenceAvailable } from '@/services/native-runtime';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type LlamaContext = {
  completion: (
    options: {
      messages: ChatMessage[];
      n_predict: number;
      stop: string[];
    },
    onData?: (data: { token: string }) => void,
  ) => Promise<{
    timings: {
      predicted_per_second: number;
    };
  }>;
};

type LlamaModule = {
  initLlama: (options: {
    model: string;
    use_mlock?: boolean;
    n_ctx?: number;
    n_gpu_layers?: number;
  }) => Promise<LlamaContext>;
  releaseAllLlama: () => Promise<void>;
};

const HF_REPO = 'unsloth/gemma-3-1b-it-GGUF';
const HF_FILENAME = 'gemma-3-1b-it-IQ4_NL.gguf';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
// Explicitly define stop sequences for Gemma 3
const STOP_WORDS = ['<end_of_turn>', '<eos>'];

let activeContext: LlamaContext | null = null;
let isActive = false;

export type ModelProgressCallback = (message: string, percent: number) => void;

function getLlamaModule(): LlamaModule {
  assertNativeInferenceAvailable();

  try {
    return require('llama.rn') as LlamaModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown native load error';
    throw new Error(`Native module is unavailable: ${message}`);
  }
}

async function ensureModelsDir() {
  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export async function isModelDownloaded(): Promise<boolean> {
  const targetPath = `${MODELS_DIR}${HF_FILENAME}`;
  const fileInfo = await FileSystem.getInfoAsync(targetPath);
  return fileInfo.exists;
}

export async function downloadGemmaModel(
  onProgress?: ModelProgressCallback,
) {
  await ensureModelsDir();

  const targetPath = `${MODELS_DIR}${HF_FILENAME}`;
  const fileInfo = await FileSystem.getInfoAsync(targetPath);
  if (fileInfo.exists) {
    onProgress?.(`Model already cached`, 100);
    return targetPath;
  }

  const url = `https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILENAME}`;
  const task = FileSystem.createDownloadResumable(url, targetPath, {}, (event) => {
    if (!event.totalBytesExpectedToWrite) {
      onProgress?.(`Downloading ${HF_FILENAME}...`, 0);
      return;
    }
    const percent = Math.round(
      (event.totalBytesWritten / event.totalBytesExpectedToWrite) * 100,
    );
    onProgress?.(`Downloading... ${percent}%`, percent);
  });

  onProgress?.(`Downloading...`, 0);
  const result = await task.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Failed to download ${HF_FILENAME}`);
  }

  onProgress?.(`Ready`, 100);
  return targetPath;
}

export async function loadGemmaModel() {
  const llama = getLlamaModule();
  const path = `${MODELS_DIR}${HF_FILENAME}`;
  const fileInfo = await FileSystem.getInfoAsync(path);

  if (!fileInfo.exists) {
    throw new Error(`Model file is missing`);
  }

  if (activeContext && isActive) {
    return;
  }

  await llama.releaseAllLlama();
  activeContext = await llama.initLlama({
    model: path,
    use_mlock: true,
    n_ctx: 2048,
    n_gpu_layers: 1, // Utilize Android GPU via standard llama.cpp backend if available
  });
  isActive = true;
}

export async function unloadGemmaModel() {
  const llama = getLlamaModule();
  await llama.releaseAllLlama().catch(() => { });
  activeContext = null;
  isActive = false;
}

export function isGemmaLoaded() {
  return isActive;
}

export async function sendGemmaMessage(
  messages: ChatMessage[],
  onToken?: (text: string) => void,
) {
  if (!activeContext) {
    throw new Error('Load the model before sending a message.');
  }

  let output = '';
  const result = await activeContext.completion(
    {
      messages,
      n_predict: 500,
      stop: STOP_WORDS,
    },
    (data) => {
      output += data.token;
      onToken?.(output);
    },
  );

  return {
    text: output.trim(),
    tokensPerSecond: result.timings.predicted_per_second,
  };
}
