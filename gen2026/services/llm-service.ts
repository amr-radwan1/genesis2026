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

const HF_REPO = 'medmekk/Qwen2.5-0.5B-Instruct.GGUF';
const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
const STOP_WORDS = ['</s>', '<|end|>', '<|im_end|>', '<|eot_id|>', '<|end_of_text|>'];

let activeContext: LlamaContext | null = null;
let activeModelName: string | null = null;

export type ModelProgressCallback = (message: string, percent: number) => void;

function getLlamaModule(): LlamaModule {
  assertNativeInferenceAvailable();

  try {
    return require('llama.rn') as LlamaModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown native load error';
    throw new Error(`Qwen native module is unavailable: ${message}`);
  }
}

async function ensureModelsDir() {
  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export async function fetchAvailableQwenModels() {
  const response = await fetch(`https://huggingface.co/api/models/${HF_REPO}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Qwen formats: ${response.status}`);
  }

  const data = await response.json();
  return (data.siblings ?? [])
    .map((file: { rfilename?: string }) => file.rfilename)
    .filter((name: string | undefined): name is string => Boolean(name?.endsWith('.gguf')))
    .sort((left: string, right: string) => left.localeCompare(right));
}

export async function getDownloadedQwenModels() {
  await ensureModelsDir();
  const files = await FileSystem.readDirectoryAsync(MODELS_DIR);
  return files.filter((name) => name.endsWith('.gguf'));
}

export async function downloadQwenModel(
  fileName: string,
  onProgress?: ModelProgressCallback,
) {
  await ensureModelsDir();

  const targetPath = `${MODELS_DIR}${fileName}`;
  const fileInfo = await FileSystem.getInfoAsync(targetPath);
  if (fileInfo.exists) {
    onProgress?.(`${fileName} already cached`, 100);
    return targetPath;
  }

  const url = `https://huggingface.co/${HF_REPO}/resolve/main/${fileName}`;
  const task = FileSystem.createDownloadResumable(url, targetPath, {}, (event) => {
    if (!event.totalBytesExpectedToWrite) {
      onProgress?.(`Downloading ${fileName}...`, 0);
      return;
    }
    const percent = Math.round(
      (event.totalBytesWritten / event.totalBytesExpectedToWrite) * 100,
    );
    onProgress?.(`Downloading ${fileName}... ${percent}%`, percent);
  });

  onProgress?.(`Downloading ${fileName}...`, 0);
  const result = await task.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Failed to download ${fileName}`);
  }

  onProgress?.(`${fileName} ready`, 100);
  return targetPath;
}

export async function loadQwenModel(fileName: string) {
  const llama = getLlamaModule();
  const path = `${MODELS_DIR}${fileName}`;
  const fileInfo = await FileSystem.getInfoAsync(path);

  if (!fileInfo.exists) {
    throw new Error(`Model file is missing: ${fileName}`);
  }

  if (activeContext && activeModelName === fileName) {
    return { fileName };
  }

  await llama.releaseAllLlama();
  activeContext = await llama.initLlama({
    model: path,
    use_mlock: true,
    n_ctx: 2048,
    n_gpu_layers: 1,
  });
  activeModelName = fileName;

  return { fileName };
}

export async function unloadQwenModel() {
  const llama = getLlamaModule();
  await llama.releaseAllLlama();
  activeContext = null;
  activeModelName = null;
}

export function getActiveQwenModel() {
  return activeModelName;
}

export async function sendQwenMessage(
  messages: ChatMessage[],
  onToken?: (text: string) => void,
) {
  if (!activeContext) {
    throw new Error('Load a Qwen model before sending a message.');
  }

  let output = '';
  const result = await activeContext.completion(
    {
      messages,
      n_predict: 1000,
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
