import { NativeModules } from 'react-native';

import { assertNativeInferenceAvailable } from '@/services/native-runtime';

type BitnetNativeResult = {
  text: string;
  tokensPerSecond: number;
};

type BitnetModule = {
  initBackend: () => Promise<boolean>;
  loadModel: (modelPath: string, contextLength: number, threadCount: number) => Promise<boolean>;
  generate: (
    prompt: string,
    maxTokens: number,
    temperature: number,
    topP: number,
  ) => Promise<BitnetNativeResult>;
  release: () => Promise<boolean>;
  isLoaded: () => Promise<boolean>;
};

function getBitnetModule(): BitnetModule {
  assertNativeInferenceAvailable();

  const module = NativeModules.BitnetBridge as BitnetModule | undefined;
  if (!module) {
    throw new Error('BitNet bridge is unavailable. Rebuild the Android dev client.');
  }

  return module;
}

export async function initializeBitnetBackend() {
  await getBitnetModule().initBackend();
}

export async function loadBitnetModel(
  modelPath: string,
  contextLength: number,
  threadCount = 0,
) {
  const bitnet = getBitnetModule();
  await bitnet.initBackend();
  await bitnet.loadModel(modelPath, contextLength, threadCount);
}

export async function generateBitnetText(
  prompt: string,
  maxTokens = 256,
  temperature = 0.7,
  topP = 0.9,
) {
  return getBitnetModule().generate(prompt, maxTokens, temperature, topP);
}

export async function releaseBitnetModel() {
  await getBitnetModule().release();
}

export async function getBitnetLoadedStatus() {
  return getBitnetModule().isLoaded();
}
