import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  ChatMessage,
  downloadQwenModel,
  fetchAvailableQwenModels,
  getActiveQwenModel,
  getDownloadedQwenModels,
  loadQwenModel,
  sendQwenMessage,
  unloadQwenModel,
} from '@/services/llm-service';
import { getNativeInferenceStatus } from '@/services/native-runtime';
import {
  ensureModelsDownloaded,
  getWhisperModelStatus,
  startLiveTranscription,
  stopLiveTranscription,
  transcribeAudio,
} from '@/services/whisper-service';

const SYSTEM_PROMPT =
  'You are a concise on-device assistant. Answer directly and keep responses useful.';

export default function HomeScreen() {
  const nativeStatus = useMemo(() => getNativeInferenceStatus(), []);

  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioFileUri, setAudioFileUri] = useState<string | null>(null);
  const [whisperReady, setWhisperReady] = useState(false);
  const [whisperProgress, setWhisperProgress] = useState('');
  const [whisperBusy, setWhisperBusy] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [liveStatus, setLiveStatus] = useState('');
  const [liveActive, setLiveActive] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmProgress, setLlmProgress] = useState('');
  const [composer, setComposer] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'system', content: SYSTEM_PROMPT },
  ]);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeModelName = getActiveQwenModel();
  const visibleChat = chat.filter((message) => message.role !== 'system');
  const latestCapture = liveTranscript || transcript;

  const refreshNativeState = useCallback(async () => {
    if (!nativeStatus.available) {
      return;
    }

    try {
      const [whisperStatus, models, downloaded] = await Promise.all([
        getWhisperModelStatus(),
        fetchAvailableQwenModels(),
        getDownloadedQwenModels(),
      ]);

      setWhisperReady(whisperStatus.ready);
      setAvailableModels(models);
      setDownloadedModels(downloaded);
      setSelectedModel((current) => current ?? downloaded[0] ?? models[0] ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read native state.';
      setErrorMessage(message);
    }
  }, [nativeStatus.available]);

  useEffect(() => {
    refreshNativeState();
  }, [refreshNativeState]);

  useEffect(() => {
    return () => {
      stopLiveTranscription().catch(() => undefined);
    };
  }, []);

  function pushCaptureIntoComposer(source: string) {
    const cleaned = source.trim();
    if (!cleaned) {
      return;
    }

    setComposer((current) => (current.trim() ? `${current.trim()}\n\n${cleaned}` : cleaned));
  }

  function clearCaptureBuffers() {
    setTranscript('');
    setLiveTranscript('');
    setAudioFileName(null);
    setAudioFileUri(null);
  }

  async function pickAudioAsync() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets?.length) {
        setAudioFileName(result.assets[0].name);
        setAudioFileUri(result.assets[0].uri);
        setTranscript('');
        setErrorMessage(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audio picker failed.';
      setErrorMessage(message);
    }
  }

  async function handlePrepareWhisper() {
    setWhisperBusy(true);
    setWhisperProgress('Preparing Whisper...');
    setErrorMessage(null);

    try {
      await ensureModelsDownloaded((message) => {
        setWhisperProgress(message);
      });

      const status = await getWhisperModelStatus();
      setWhisperReady(status.ready);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Whisper setup failed.';
      setErrorMessage(message);
    } finally {
      setWhisperBusy(false);
    }
  }

  async function handleTranscribe() {
    if (!audioFileUri) {
      setErrorMessage('Select a WAV file first.');
      return;
    }

    setWhisperBusy(true);
    setTranscript('');
    setErrorMessage(null);

    try {
      const result = await transcribeAudio(audioFileUri, audioFileName ?? undefined, (message) => {
        setWhisperProgress(message);
      });
      setTranscript(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed.';
      setErrorMessage(message);
    } finally {
      setWhisperBusy(false);
    }
  }

  async function handleStartLiveTranscription() {
    setLiveBusy(true);
    setLiveStatus('Preparing live transcription...');
    setLiveTranscript('');
    setErrorMessage(null);

    try {
      await startLiveTranscription(
        (message) => {
          setLiveTranscript(message);
        },
        (message) => {
          setLiveStatus(message);
          if (message === 'Live transcription stopped.') {
            setLiveActive(false);
          }
        },
      );
      setLiveActive(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start live transcription.';
      setErrorMessage(message);
      setLiveStatus(message);
      setLiveActive(false);
    } finally {
      setLiveBusy(false);
    }
  }

  async function handleStopLiveTranscription() {
    setLiveBusy(true);

    try {
      await stopLiveTranscription();
      setLiveActive(false);
      setLiveStatus('Live transcription stopped.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to stop live transcription.';
      setErrorMessage(message);
    } finally {
      setLiveBusy(false);
    }
  }

  async function handleDownloadOrLoadModel() {
    if (!selectedModel) {
      setErrorMessage('Choose a Qwen model file.');
      return;
    }

    setLlmBusy(true);
    setLlmProgress('');
    setErrorMessage(null);

    try {
      if (!downloadedModels.includes(selectedModel)) {
        await downloadQwenModel(selectedModel, (message) => {
          setLlmProgress(message);
        });
      }

      await loadQwenModel(selectedModel);
      setDownloadedModels(await getDownloadedQwenModels());
      setLlmProgress(`${selectedModel} loaded`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model load failed.';
      setErrorMessage(message);
    } finally {
      setLlmBusy(false);
    }
  }

  async function handleSendMessage() {
    if (!composer.trim()) {
      return;
    }

    const nextMessages: ChatMessage[] = [...chat, { role: 'user', content: composer.trim() }];
    const previousMessages = chat;
    setComposer('');
    setErrorMessage(null);
    setLlmBusy(true);
    setChat([...nextMessages, { role: 'assistant', content: '' }]);

    try {
      const { text, tokensPerSecond: tps } = await sendQwenMessage(nextMessages, (partial) => {
        setChat((current) => [
          ...current.slice(0, -1),
          { role: 'assistant', content: partial },
        ]);
      });

      setTokensPerSecond(Number(tps.toFixed(2)));
      setChat([...nextMessages, { role: 'assistant', content: text }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inference failed.';
      setErrorMessage(message);
      setChat(previousMessages);
    } finally {
      setLlmBusy(false);
    }
  }

  async function handleResetChat() {
    setChat([{ role: 'system', content: SYSTEM_PROMPT }]);
    setTokensPerSecond(null);
    setComposer('');
    await unloadQwenModel().catch(() => undefined);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.orbA} />
      <View style={styles.orbB} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>Genesis Studio</Text>
            <Text style={styles.heroTitle}>Local voice capture and local chat in one workspace.</Text>
            <Text style={styles.heroSubtitle}>
              The dev server only delivers the JavaScript bundle in development. Whisper and Qwen
              run locally on your phone from downloaded native models.
            </Text>
          </View>
          <View style={styles.runtimePanel}>
            <Text style={styles.runtimeLabel}>Runtime</Text>
            <View style={[styles.runtimeBadge, nativeStatus.available ? styles.runtimeReady : styles.runtimeWarn]}>
              <Text style={styles.runtimeBadgeText}>
                {nativeStatus.available ? 'Native models ready' : 'Native build required'}
              </Text>
            </View>
            <Text style={styles.runtimeBody}>{nativeStatus.reason}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Whisper</Text>
            <Text style={styles.metricValue}>{whisperReady ? 'Loaded' : 'Missing'}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Qwen</Text>
            <Text style={styles.metricValue}>{activeModelName ?? 'Not loaded'}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Mic</Text>
            <Text style={styles.metricValue}>{liveActive ? 'Live' : 'Idle'}</Text>
          </View>
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorTitle}>Attention</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Voice Console</Text>
            <Text style={styles.panelSubtitle}>
              Capture from microphone or upload a WAV, then push the text directly into the local assistant.
            </Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.primaryAction}
              onPress={handlePrepareWhisper}
              disabled={whisperBusy || liveBusy}>
              <Text style={styles.primaryActionText}>
                {whisperReady ? 'Refresh Whisper Assets' : 'Download Whisper Assets'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryAction, liveActive && styles.disabledAction]}
              onPress={handleStartLiveTranscription}
              disabled={liveBusy || whisperBusy || liveActive}>
              <Text style={styles.secondaryActionText}>Start Mic</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryAction, !liveActive && styles.disabledAction]}
              onPress={handleStopLiveTranscription}
              disabled={liveBusy || !liveActive}>
              <Text style={styles.secondaryActionText}>Stop Mic</Text>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.secondaryActionWide}
              onPress={pickAudioAsync}
              disabled={whisperBusy || liveBusy}>
              <Text style={styles.secondaryActionText}>
                {audioFileName ? audioFileName : 'Select WAV File'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.primaryActionCompact, !audioFileUri && styles.disabledAction]}
              onPress={handleTranscribe}
              disabled={!audioFileUri || whisperBusy || liveBusy}>
              <Text style={styles.primaryActionText}>Transcribe File</Text>
            </Pressable>
          </View>

          {whisperBusy || liveBusy ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#f97316" />
              <Text style={styles.statusText}>{liveBusy ? liveStatus || 'Working...' : whisperProgress}</Text>
            </View>
          ) : whisperProgress || liveStatus ? (
            <Text style={styles.statusText}>{liveStatus || whisperProgress}</Text>
          ) : null}

          <View style={styles.captureGrid}>
            <View style={styles.captureCard}>
              <View style={styles.captureHeader}>
                <Text style={styles.captureTitle}>Live Transcript</Text>
                <Pressable
                  style={[styles.inlineAction, !liveTranscript && styles.disabledAction]}
                  onPress={() => pushCaptureIntoComposer(liveTranscript)}
                  disabled={!liveTranscript}>
                  <Text style={styles.inlineActionText}>Use In Chat</Text>
                </Pressable>
              </View>
              <Text style={styles.captureBody}>
                {liveTranscript || 'Start the mic to stream local transcription in short rolling sessions.'}
              </Text>
            </View>

            <View style={styles.captureCard}>
              <View style={styles.captureHeader}>
                <Text style={styles.captureTitle}>File Transcript</Text>
                <Pressable
                  style={[styles.inlineAction, !transcript && styles.disabledAction]}
                  onPress={() => pushCaptureIntoComposer(transcript)}
                  disabled={!transcript}>
                  <Text style={styles.inlineActionText}>Use In Chat</Text>
                </Pressable>
              </View>
              <Text style={styles.captureBody}>
                {transcript || 'Upload a WAV file and Whisper will transcribe it on device.'}
              </Text>
            </View>
          </View>

          <View style={styles.captureFooter}>
            <Pressable
              style={[styles.secondaryActionWide, !latestCapture && styles.disabledAction]}
              onPress={() => pushCaptureIntoComposer(latestCapture)}
              disabled={!latestCapture}>
              <Text style={styles.secondaryActionText}>Send Latest Capture To Chat</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryActionWide, !(transcript || liveTranscript) && styles.disabledAction]}
              onPress={clearCaptureBuffers}
              disabled={!(transcript || liveTranscript)}>
              <Text style={styles.secondaryActionText}>Clear Captures</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Assistant Console</Text>
            <Text style={styles.panelSubtitle}>
              Load a Qwen GGUF on device, then move between spoken capture and local chat without leaving the same workspace.
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modelStrip}>
            {availableModels.map((model) => {
              const isSelected = selectedModel === model;
              const isDownloaded = downloadedModels.includes(model);

              return (
                <Pressable
                  key={model}
                  style={[
                    styles.modelCard,
                    isSelected && styles.modelCardSelected,
                    isDownloaded && styles.modelCardDownloaded,
                  ]}
                  onPress={() => setSelectedModel(model)}>
                  <Text style={styles.modelCardTitle}>{model}</Text>
                  <Text style={styles.modelCardMeta}>{isDownloaded ? 'Cached locally' : 'Remote file'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.actionRow}>
            <Pressable
              style={styles.primaryAction}
              onPress={handleDownloadOrLoadModel}
              disabled={llmBusy || !selectedModel}>
              <Text style={styles.primaryActionText}>
                {selectedModel && downloadedModels.includes(selectedModel) ? 'Load Selected Model' : 'Download + Load Model'}
              </Text>
            </Pressable>
            <Pressable style={styles.secondaryAction} onPress={handleResetChat}>
              <Text style={styles.secondaryActionText}>Reset Chat</Text>
            </Pressable>
          </View>

          {llmBusy ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#f97316" />
              <Text style={styles.statusText}>{llmProgress || 'Running local inference...'}</Text>
            </View>
          ) : llmProgress ? (
            <Text style={styles.statusText}>{llmProgress}</Text>
          ) : null}

          <View style={styles.chatShell}>
            <Text style={styles.chatShellTitle}>Conversation</Text>
            <ScrollView style={styles.chatFeed} contentContainerStyle={styles.chatFeedContent}>
              {visibleChat.length ? (
                visibleChat.map((message, index) => (
                  <View
                    key={`${message.role}-${index}`}
                    style={[
                      styles.messageCard,
                      message.role === 'user' ? styles.userMessageCard : styles.assistantMessageCard,
                    ]}>
                    <Text style={styles.messageTag}>
                      {message.role === 'user' ? 'You' : 'Qwen'}
                    </Text>
                    <Text
                      style={[
                        styles.messageText,
                        message.role === 'user' ? styles.userMessageText : styles.assistantMessageText,
                      ]}>
                      {message.content || '...'}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  Load a local model and start a conversation. You can also inject voice transcripts directly into the composer.
                </Text>
              )}
            </ScrollView>
          </View>

          <View style={styles.composerShell}>
            <Text style={styles.composerLabel}>Prompt Composer</Text>
            <TextInput
              style={styles.composer}
              placeholder="Ask the local assistant, or drop in a transcript from the voice console..."
              placeholderTextColor="#667085"
              value={composer}
              onChangeText={setComposer}
              multiline
            />
            <View style={styles.composerActions}>
              <Pressable
                style={[styles.secondaryActionWide, !latestCapture && styles.disabledAction]}
                onPress={() => pushCaptureIntoComposer(latestCapture)}
                disabled={!latestCapture}>
                <Text style={styles.secondaryActionText}>Insert Latest Capture</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryActionCompact, llmBusy && styles.disabledAction]}
                onPress={handleSendMessage}
                disabled={llmBusy}>
                <Text style={styles.primaryActionText}>Send</Text>
              </Pressable>
            </View>
            <View style={styles.footerStats}>
              <Text style={styles.footerStatLabel}>Model</Text>
              <Text style={styles.footerStatValue}>{activeModelName ?? 'Not loaded'}</Text>
              <Text style={styles.footerDivider}>•</Text>
              <Text style={styles.footerStatLabel}>Speed</Text>
              <Text style={styles.footerStatValue}>
                {tokensPerSecond ? `${tokensPerSecond} tok/s` : 'Idle'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#07111f',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 36,
    gap: 16,
  },
  orbA: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(249, 115, 22, 0.18)',
  },
  orbB: {
    position: 'absolute',
    top: 180,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(20, 184, 166, 0.12)',
  },
  hero: {
    backgroundColor: '#0e1a2b',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    padding: 22,
    gap: 18,
  },
  heroCopy: {
    gap: 10,
  },
  eyebrow: {
    color: '#f97316',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#f8fafc',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 22,
  },
  runtimePanel: {
    backgroundColor: '#111f33',
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  runtimeLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  runtimeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  runtimeReady: {
    backgroundColor: '#12352e',
  },
  runtimeWarn: {
    backgroundColor: '#412312',
  },
  runtimeBadgeText: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  runtimeBody: {
    color: '#cbd5e1',
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#0e1a2b',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    padding: 14,
    gap: 6,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#3b1218',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    padding: 16,
    gap: 6,
  },
  errorTitle: {
    color: '#fecaca',
    fontWeight: '800',
  },
  errorText: {
    color: '#fee2e2',
    lineHeight: 20,
  },
  panel: {
    backgroundColor: '#0e1a2b',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    padding: 18,
    gap: 16,
  },
  panelHeader: {
    gap: 8,
  },
  panelTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
  },
  panelSubtitle: {
    color: '#94a3b8',
    lineHeight: 21,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryAction: {
    flexGrow: 1,
    minWidth: 160,
    backgroundColor: '#f97316',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryActionCompact: {
    minWidth: 120,
    backgroundColor: '#f97316',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryActionText: {
    color: '#111827',
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryAction: {
    minWidth: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: '#101d30',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryActionWide: {
    flexGrow: 1,
    minWidth: 160,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: '#101d30',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryActionText: {
    color: '#e2e8f0',
    fontWeight: '700',
    textAlign: 'center',
  },
  disabledAction: {
    opacity: 0.4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    color: '#cbd5e1',
    lineHeight: 20,
  },
  captureGrid: {
    gap: 12,
  },
  captureCard: {
    backgroundColor: '#101d30',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.14)',
    padding: 16,
    gap: 12,
  },
  captureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  captureTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  captureBody: {
    color: '#dbe4ee',
    lineHeight: 22,
  },
  inlineAction: {
    borderRadius: 999,
    backgroundColor: '#16324f',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineActionText: {
    color: '#cfe7ff',
    fontSize: 12,
    fontWeight: '700',
  },
  captureFooter: {
    gap: 10,
  },
  modelStrip: {
    gap: 10,
  },
  modelCard: {
    width: 210,
    borderRadius: 22,
    backgroundColor: '#101d30',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    padding: 14,
    gap: 8,
  },
  modelCardSelected: {
    borderColor: '#f97316',
    backgroundColor: '#1b2230',
  },
  modelCardDownloaded: {
    shadowColor: '#14b8a6',
  },
  modelCardTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  modelCardMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  chatShell: {
    backgroundColor: '#0b1524',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    padding: 14,
    gap: 12,
  },
  chatShellTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
  },
  chatFeed: {
    maxHeight: 380,
  },
  chatFeedContent: {
    gap: 10,
  },
  messageCard: {
    borderRadius: 20,
    padding: 14,
    gap: 8,
  },
  userMessageCard: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: '#f97316',
  },
  assistantMessageCard: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    backgroundColor: '#101d30',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
  },
  messageTag: {
    color: '#0f172a',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  messageText: {
    lineHeight: 21,
  },
  userMessageText: {
    color: '#111827',
  },
  assistantMessageText: {
    color: '#e2e8f0',
  },
  emptyText: {
    color: '#94a3b8',
    lineHeight: 21,
  },
  composerShell: {
    gap: 12,
  },
  composerLabel: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
  },
  composer: {
    minHeight: 120,
    borderRadius: 22,
    backgroundColor: '#101d30',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f8fafc',
    textAlignVertical: 'top',
  },
  composerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  footerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerStatLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  footerStatValue: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  footerDivider: {
    color: '#475569',
  },
});
