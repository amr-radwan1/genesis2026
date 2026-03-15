import * as FileSystem from 'expo-file-system/legacy';
import { toastService } from '@/services/toast-service';
import { assertNativeInferenceAvailable } from '@/services/native-runtime';
import { addNote, addTodo, addCustomEntry } from '@/services/memory-store';

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

export async function checkAndAutoLoadGemma() {
  try {
    if (isActive) return;
    const downloaded = await isModelDownloaded();
    if (downloaded) {
      console.log('[LLM] Auto-loading Gemma at startup...');
      await loadGemmaModel();
      console.log('[LLM] Gemma loaded successfully.');
    }
  } catch (err) {
    console.error('[LLM] Auto-load failed:', err);
  }
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

/**
 * Runs Gemma on a transcript to extract notes, todos, and key-value facts,
 * then adds them to the memory store. Fire-and-forget — errors are swallowed.
 */
export async function extractMemoryFromTranscript(transcript: string): Promise<void> {
  if (!activeContext || !isActive) return;

  // Cap transcript length to keep it manageable for the 1B model
  const trimmed = transcript.trim().slice(0, 1200);
  if (!trimmed) return;

  const prompt: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a selective memory extraction assistant. Your goal is to capture ONLY genuinely noteworthy information that has long-term value (decisions, core insights, specific action items, or important facts like names/dates). This assistant runs all day, so be BRIEF and highly DISCRIMINATING. Most conversation is NOT worth remembering. Return a JSON object with exactly these fields:\n- "notes": array of strings (truly key insights or decisions)\n- "todos": array of strings (concrete, specific action items)\n- "custom": array of {"label": string, "value": string} (important personal facts)\n\nIf nothing is highly noteworthy, return {"notes":[],"todos":[],"custom":[]}.\nReturn ONLY valid JSON. No explanation, no markdown.',
    },
    {
      role: 'user',
      content: `Transcription:\n"""\n${trimmed}\n"""`,
    },
  ];

    const toastId = toastService.show('AI is analyzing context...', 'loading', 0);

    try {
      let raw = '';
      await activeContext.completion(
        { messages: prompt, n_predict: 300, stop: STOP_WORDS },
        (data) => { raw += data.token; },
      );

      // Extract JSON even if there's surrounding text
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        toastService.hide(toastId);
        return;
      }

      const parsed = JSON.parse(match[0]);
      let addedCount = 0;

      if (Array.isArray(parsed.notes)) {
        for (const text of parsed.notes) {
          if (typeof text === 'string' && text.trim()) {
            addNote(text.trim(), 'ai');
            addedCount++;
          }
        }
      }
      if (Array.isArray(parsed.todos)) {
        for (const text of parsed.todos) {
          if (typeof text === 'string' && text.trim()) {
            addTodo(text.trim(), 'ai');
            addedCount++;
          }
        }
      }
      if (Array.isArray(parsed.custom)) {
        for (const entry of parsed.custom) {
          if (entry && typeof entry.label === 'string' && typeof entry.value === 'string') {
            addCustomEntry(entry.label.trim(), entry.value.trim());
            addedCount++;
          }
        }
      }

      if (addedCount > 0) {
        toastService.update(toastId, {
          message: 'Memory extracted! ✦',
          type: 'success',
          duration: 3000
        });
      } else {
        toastService.hide(toastId);
      }
    } catch (err) {
      console.error('[LLM] Extraction failed:', err);
      toastService.hide(toastId);
    }
}
