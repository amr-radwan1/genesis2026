// Type declarations for whisper.rn
// The package exports field with "react-native" condition causes TypeScript
// bundler resolution to resolve to src/ instead of lib/typescript/.
// This shim re-declares the module with the needed types.

declare module 'whisper.rn' {
  export type TranscribeOptions = {
    language?: string;
    maxLen?: number;
    tokenTimestamps?: boolean;
    translate?: boolean;
    [key: string]: any;
  };

  export type TranscribeResult = {
    result: string;
    segments: Array<{
      text: string;
      t0: number;
      t1: number;
    }>;
    isAborted?: boolean;
  };

  export type TranscribeNewSegmentsResult = {
    nNew: number;
    totalNNew: number;
    result: string;
    segments: TranscribeResult['segments'];
  };

  export type TranscribeFileOptions = TranscribeOptions & {
    onProgress?: (progress: number) => void;
    onNewSegments?: (result: TranscribeNewSegmentsResult) => void;
  };

  export type VadOptions = {
    threshold?: number;
    minSpeechDurationMs?: number;
    minSilenceDurationMs?: number;
    maxSpeechDurationS?: number;
    speechPadMs?: number;
    samplesOverlap?: number;
  };

  export type VadSegment = {
    t0: number;
    t1: number;
  };

  export class WhisperContext {
    id: number;
    gpu: boolean;
    reasonNoGPU: string;
    transcribe(
      filePathOrBase64: string | number,
      options?: TranscribeFileOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    transcribeData(
      data: string | ArrayBuffer,
      options?: TranscribeFileOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    release(): Promise<void>;
  }

  export type ContextOptions = {
    filePath: string | number;
    isBundleAsset?: boolean;
    useCoreMLIos?: boolean;
    useGpu?: boolean;
    useFlashAttn?: boolean;
    coreMLModelAsset?: {
      filename: string;
      assets: string[] | number[];
    };
  };

  export class WhisperVadContext {
    id: number;
    gpu: boolean;
    reasonNoGPU: string;
    detectSpeech(
      filePathOrBase64: string | number,
      options?: VadOptions,
    ): Promise<VadSegment[]>;
    detectSpeechData(
      audioData: string | ArrayBuffer,
      options?: VadOptions,
    ): Promise<VadSegment[]>;
    release(): Promise<void>;
  }

  export type VadContextOptions = {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    nThreads?: number;
  };

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>;
  export function initWhisperVad(options: VadContextOptions): Promise<WhisperVadContext>;
  export function releaseAllWhisper(): Promise<void>;
  export function releaseAllWhisperVad(): Promise<void>;

  export const libVersion: string;
  export const isUseCoreML: boolean;
  export const isCoreMLAllowFallback: boolean;
}
