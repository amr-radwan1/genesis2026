import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { transcribeAudio } from '@/services/whisper-service';

export default function HomeScreen() {
  // File picker state
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioFileUri, setAudioFileUri] = useState<string | null>(null);

  // Recorder state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState('');
  const [transcriptionText, setTranscriptionText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Format seconds to MM:SS
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Recording ───────────────────────────────────
  const startRecording = async () => {
    try {
      setErrorMessage(null);
      setTranscriptionText(null);
      setRecordedUri(null);
      setAudioFileName(null);
      setAudioFileUri(null);

      // Request microphone permission
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage('Microphone permission is required to record audio.');
        return;
      }

      // Configure audio session
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create recording with 16kHz mono settings for Whisper compatibility
      const recordingOptions: Audio.RecordingOptions = {
        android: {
          extension: '.wav',
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/wav',
          bitsPerSecond: 256000,
        },
      };

      const { recording: newRecording } = await Audio.Recording.createAsync(recordingOptions);
      setRecording(newRecording);
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      console.log('[Recorder] Recording started');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(`Failed to start recording: ${msg}`);
      console.error('[Recorder] Start error:', error);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      // Stop timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      console.log('[Recorder] Recording stopped, URI:', uri);

      setRecording(null);
      setIsRecording(false);

      if (uri) {
        setRecordedUri(uri);
      } else {
        setErrorMessage('Recording failed — no audio file was saved.');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(`Failed to stop recording: ${msg}`);
      console.error('[Recorder] Stop error:', error);
    }
  };

  // ─── File Picker ─────────────────────────────────
  const pickAudioAsync = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAudioFileName(result.assets[0].name);
        setAudioFileUri(result.assets[0].uri);
        setRecordedUri(null);
        setTranscriptionText(null);
        setErrorMessage(null);
      }
    } catch (error) {
      console.error('Error picking audio file', error);
    }
  };

  // ─── Transcription ───────────────────────────────
  const handleTranscribe = async () => {
    const uri = recordedUri || audioFileUri;
    if (!uri) return;

    setIsTranscribing(true);
    setTranscriptionText(null);
    setErrorMessage(null);
    setProgress('Starting...');

    try {
      const result = await transcribeAudio(uri, (message, _percent) => {
        setProgress(message);
      });
      setTranscriptionText(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(msg);
    } finally {
      setIsTranscribing(false);
      setProgress('');
    }
  };

  const hasAudio = !!recordedUri || !!audioFileUri;

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>

      {/* ── Record Section ── */}
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Record Audio</ThemedText>

        {!isRecording ? (
          <Pressable
            onPress={startRecording}
            style={[styles.recordButton, isTranscribing && styles.disabledButton]}
            disabled={isTranscribing}
          >
            <ThemedText style={styles.recordButtonText}>
              🎙️ Start Recording
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.recordingActiveContainer}>
            <View style={styles.recordingInfo}>
              <View style={styles.recordingDot} />
              <ThemedText style={styles.recordingText}>
                Recording... {formatDuration(recordingDuration)}
              </ThemedText>
            </View>
            <Pressable onPress={stopRecording} style={styles.stopButton}>
              <ThemedText style={styles.stopButtonText}>
                ⏹ Stop
              </ThemedText>
            </Pressable>
          </View>
        )}

        {recordedUri && !isRecording && (
          <ThemedText style={styles.recordedLabel}>
            ✅ Recording saved ({formatDuration(recordingDuration)})
          </ThemedText>
        )}
      </ThemedView>

      {/* ── Or Upload Section ── */}
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Or Upload Audio</ThemedText>

        <Pressable onPress={pickAudioAsync} style={styles.selectButton}>
          <ThemedText style={styles.selectButtonText}>
            {audioFileName ? `📎 ${audioFileName}` : '🎵 Select an Audio File'}
          </ThemedText>
        </Pressable>
      </ThemedView>

      {/* ── Transcribe Button ── */}
      {hasAudio && !isTranscribing && !isRecording && (
        <ThemedView style={styles.stepContainer}>
          <Pressable onPress={handleTranscribe} style={styles.transcribeButton}>
            <ThemedText style={styles.transcribeButtonText}>
              ✨ Transcribe
            </ThemedText>
          </Pressable>
        </ThemedView>
      )}

      {/* ── Progress ── */}
      {isTranscribing && (
        <ThemedView style={styles.progressContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
          <ThemedText style={styles.progressText}>{progress}</ThemedText>
        </ThemedView>
      )}

      {/* ── Error ── */}
      {errorMessage && (
        <ThemedView style={styles.stepContainer}>
          <ThemedText style={styles.errorText}>⚠️ {errorMessage}</ThemedText>
        </ThemedView>
      )}

      {/* ── Transcription Result ── */}
      {transcriptionText && (
        <ThemedView style={styles.resultContainer}>
          <ThemedText type="subtitle">Transcription</ThemedText>
          <ScrollView style={styles.resultScroll} nestedScrollEnabled>
            <ThemedText style={styles.resultText}>{transcriptionText}</ThemedText>
          </ScrollView>
        </ThemedView>
      )}
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  stepContainer: {
    gap: 12,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  // Record button
  recordButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  disabledButton: {
    opacity: 0.4,
  },
  // Recording active state
  recordingActiveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    borderRadius: 12,
    padding: 16,
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  recordingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  recordedLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  // File picker
  selectButton: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderWidth: 1,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  selectButtonText: {
    color: '#007AFF',
    fontWeight: '600',
    fontSize: 16,
  },
  // Transcribe
  transcribeButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  transcribeButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  // Progress
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  progressText: {
    fontSize: 14,
    opacity: 0.7,
  },
  // Error
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
  },
  // Result
  resultContainer: {
    gap: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    flex: 1,
  },
  resultScroll: {
    flexGrow: 1,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 22,
  },
});
