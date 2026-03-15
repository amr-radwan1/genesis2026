import * as FileSystem from 'expo-file-system/legacy';

import {
  generateBitnetText,
  loadBitnetModel,
  releaseBitnetModel,
} from '@/services/bitnet-service';
import { assertNativeInferenceAvailable } from '@/services/native-runtime';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmModelDescriptor = {
  id: string;
  engine: 'llama' | 'bitnet';
  family: string;
  label: string;
  repo: string;
  fileName: string;
  sizeBytes?: number;
  contextLength?: number;
  note?: string;
  supported?: boolean;
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
  loadLlamaModelInfo?: (model: string) => Promise<Record<string, unknown>>;
};

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
const STOP_WORDS = ['</s>', '<|end|>', '<|im_end|>', '<|eot_id|>', '<|end_of_text|>'];
const CACHE_TOLERANCE_BYTES = 4096;

const MODEL_CATALOG: LlmModelDescriptor[] = [
  {
    id: 'qwen:Qwen2.5-0.5B-Instruct-IQ3_M_imat.gguf',
    engine: 'llama',
    family: 'qwen',
    label: 'Qwen 2.5 0.5B',
    repo: 'medmekk/Qwen2.5-0.5B-Instruct.GGUF',
    fileName: 'Qwen2.5-0.5B-Instruct-IQ3_M_imat.gguf',
    contextLength: 2048,
    note: 'Fast default local assistant.',
    supported: true,
  },
  {
    id: 'bitnet:ggml-model-i2_s.gguf',
    engine: 'bitnet',
    family: 'bitnet',
    label: 'BitNet b1.58 2B 4T',
    repo: 'microsoft/bitnet-b1.58-2B-4T-gguf',
    fileName: 'ggml-model-i2_s.gguf',
    sizeBytes: 1187801280,
    contextLength: 4096,
    note: 'Official Microsoft BitNet checkpoint. Disabled in this build because the compiled kernel preset is targeting bitnet_b1_58-large first.',
    supported: false,
  },
  {
    id: 'bitnet:bitnet_b1_58-large.Q2_K.gguf',
    engine: 'bitnet',
    family: 'bitnet',
    label: 'BitNet b1.58 Large Q2',
    repo: 'RichardErkhov/1bitLLM_-_bitnet_b1_58-large-gguf',
    fileName: 'bitnet_b1_58-large.Q2_K.gguf',
    sizeBytes: 291708608,
    contextLength: 2048,
    note: 'Smaller BitNet-family GGUF for the bitnet_b1_58-large native kernel preset.',
    supported: true,
  },
  {
    id: 'bitnet:bitnet_b1_58-large.Q4_K_M.gguf',
    engine: 'bitnet',
    family: 'bitnet',
    label: 'BitNet b1.58 Large Q4',
    repo: 'RichardErkhov/1bitLLM_-_bitnet_b1_58-large-gguf',
    fileName: 'bitnet_b1_58-large.Q4_K_M.gguf',
    sizeBytes: 450887360,
    contextLength: 2048,
    note: 'Higher-quality BitNet-family GGUF for the bitnet_b1_58-large native kernel preset.',
    supported: true,
  },
];

let activeContext: LlamaContext | null = null;
let activeModelId: string | null = null;
let activeModelDescriptor: LlmModelDescriptor | null = null;

export type ModelProgressCallback = (message: string, percent: number) => void;

function getLlamaModule(): LlamaModule {
  assertNativeInferenceAvailable();

  try {
    return require('llama.rn') as LlamaModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown native load error';
    throw new Error(`Local LLM native module is unavailable: ${message}`);
  }
}

function getStorageFileName(descriptor: Pick<LlmModelDescriptor, 'family' | 'fileName'>) {
  return `${descriptor.family}__${descriptor.fileName}`;
}

function parseStorageFileName(fileName: string) {
  const separator = '__';
  const separatorIndex = fileName.indexOf(separator);

  if (separatorIndex === -1) {
    return null;
  }

  return {
    family: fileName.slice(0, separatorIndex),
    fileName: fileName.slice(separatorIndex + separator.length),
  };
}

async function ensureModelsDir() {
  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

function findDescriptor(id: string) {
  return MODEL_CATALOG.find((model) => model.id === id) ?? null;
}

function isFileSizeValid(actualSize: number | undefined, expectedSize: number | undefined) {
  if (!expectedSize) {
    return true;
  }

  if (!actualSize || actualSize <= 0) {
    return false;
  }

  return Math.abs(actualSize - expectedSize) <= CACHE_TOLERANCE_BYTES;
}

async function getCachedModelInfo(descriptor: LlmModelDescriptor) {
  const path = `${MODELS_DIR}${getStorageFileName(descriptor)}`;
  const info = await FileSystem.getInfoAsync(path);
  const size = 'size' in info && typeof info.size === 'number' ? info.size : undefined;
  const valid = info.exists && isFileSizeValid(size, descriptor.sizeBytes);

  return {
    path,
    exists: info.exists,
    size,
    valid,
  };
}

function buildBitnetPrompt(messages: ChatMessage[]) {
  const promptBody = messages
    .map((message) => {
      if (message.role === 'system') {
        return `<|start_header_id|>system<|end_header_id|>\n\n${message.content}<|eot_id|>`;
      }

      if (message.role === 'user') {
        return `<|start_header_id|>user<|end_header_id|>\n\n${message.content}<|eot_id|>`;
      }

      return `<|start_header_id|>assistant<|end_header_id|>\n\n${message.content}<|eot_id|>`;
    })
    .join('');

  return `<|begin_of_text|>${promptBody}<|start_header_id|>assistant<|end_header_id|>\n\n`;
}

export async function fetchAvailableLlmModels() {
  return MODEL_CATALOG;
}

export async function getDownloadedLlmModels() {
  await ensureModelsDir();
  const files = await FileSystem.readDirectoryAsync(MODELS_DIR);

  const downloaded = await Promise.all(
    files
      .filter((name) => name.endsWith('.gguf'))
      .map(async (name) => {
        const parsed = parseStorageFileName(name);
        if (!parsed) {
          return null;
        }

        const descriptor = MODEL_CATALOG.find(
          (model) => model.family === parsed.family && model.fileName === parsed.fileName,
        );
        if (!descriptor) {
          return null;
        }

        const info = await getCachedModelInfo(descriptor);
        return info.valid ? descriptor : null;
      }),
  );

  return downloaded.filter((descriptor): descriptor is LlmModelDescriptor => descriptor !== null);
}

export async function downloadLlmModel(
  descriptor: LlmModelDescriptor,
  onProgress?: ModelProgressCallback,
) {
  await ensureModelsDir();

  const cached = await getCachedModelInfo(descriptor);
  if (cached.valid) {
    onProgress?.(`${descriptor.fileName} already cached`, 100);
    return cached.path;
  }

  if (cached.exists) {
    await FileSystem.deleteAsync(cached.path, { idempotent: true });
    onProgress?.(`Removed incomplete cache for ${descriptor.fileName}`, 0);
  }

  const url = `https://huggingface.co/${descriptor.repo}/resolve/main/${descriptor.fileName}`;
  const task = FileSystem.createDownloadResumable(url, cached.path, {}, (event) => {
    if (!event.totalBytesExpectedToWrite) {
      onProgress?.(`Downloading ${descriptor.fileName}...`, 0);
      return;
    }
    const percent = Math.round(
      (event.totalBytesWritten / event.totalBytesExpectedToWrite) * 100,
    );
    onProgress?.(`Downloading ${descriptor.fileName}... ${percent}%`, percent);
  });

  onProgress?.(`Downloading ${descriptor.fileName}...`, 0);
  const result = await task.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Failed to download ${descriptor.fileName}`);
  }

  const completed = await getCachedModelInfo(descriptor);
  if (!completed.valid) {
    await FileSystem.deleteAsync(cached.path, { idempotent: true });
    throw new Error(
      `Downloaded ${descriptor.fileName}, but the file size does not match the expected model size. Please retry on a stable connection.`,
    );
  }

  onProgress?.(`${descriptor.fileName} ready`, 100);
  return completed.path;
}

export async function loadLlmModel(descriptor: LlmModelDescriptor) {
  const cached = await getCachedModelInfo(descriptor);

  if (descriptor.supported === false) {
    throw new Error(`${descriptor.label} is disabled on this build.`);
  }

  if (!cached.exists) {
    throw new Error(`Model file is missing: ${descriptor.fileName}`);
  }

  if (!cached.valid) {
    throw new Error(
      `${descriptor.label} is cached, but the file is incomplete or corrupt. Download it again before loading.`,
    );
  }

  if (activeModelId === descriptor.id) {
    return { descriptor };
  }

  try {
    if (descriptor.engine === 'bitnet') {
      const llama = getLlamaModule();
      await llama.releaseAllLlama();
      activeContext = null;
      await loadBitnetModel(cached.path, descriptor.contextLength ?? 2048);
    } else {
      const llama = getLlamaModule();
      await releaseBitnetModel().catch(() => undefined);
      activeContext = await llama.initLlama({
        model: cached.path,
        use_mlock: true,
        n_ctx: descriptor.contextLength ?? 2048,
        n_gpu_layers: 1,
      });
    }

    activeModelId = descriptor.id;
    activeModelDescriptor = descriptor;
    return { descriptor };
  } catch (error) {
    activeContext = null;
    activeModelId = null;
    activeModelDescriptor = null;

    const message = error instanceof Error ? error.message : 'Unknown model load error';
    throw new Error(`Failed to load ${descriptor.label}. Native error: ${message}`);
  }
}

export async function inspectLlmModel(descriptor: LlmModelDescriptor) {
  if (descriptor.engine !== 'llama') {
    return null;
  }

  const llama = getLlamaModule();
  const cached = await getCachedModelInfo(descriptor);

  if (!llama.loadLlamaModelInfo || !cached.valid) {
    return null;
  }

  return llama.loadLlamaModelInfo(cached.path);
}

export async function unloadQwenModel() {
  const llama = getLlamaModule();
  await llama.releaseAllLlama();
  await releaseBitnetModel().catch(() => undefined);
  activeContext = null;
  activeModelId = null;
  activeModelDescriptor = null;
}

export function getActiveQwenModel() {
  return activeModelId;
}

export async function sendQwenMessage(
  messages: ChatMessage[],
  onToken?: (text: string) => void,
) {
  if (!activeModelDescriptor) {
    throw new Error('Load a local model before sending a message.');
  }

  if (activeModelDescriptor.engine === 'bitnet') {
    const result = await generateBitnetText(buildBitnetPrompt(messages), 256, 0.7, 0.9);
    onToken?.(result.text);
    return result;
  }

  if (!activeContext) {
    throw new Error('Load a llama.rn model before sending a message.');
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

export function getModelCatalog() {
  return MODEL_CATALOG;
}

export function getModelDescriptorById(id: string) {
  return findDescriptor(id);
}
