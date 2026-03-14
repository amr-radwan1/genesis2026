import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { transcribeAudio } from '@/services/whisper-service';

export default function HomeScreen() {
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioFileUri, setAudioFileUri] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState('');
  const [transcriptionText, setTranscriptionText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pickAudioAsync = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setAudioFileName(result.assets[0].name);
        setAudioFileUri(result.assets[0].uri);
        setTranscriptionText(null);
        setErrorMessage(null);
      }
    } catch (error) {
      console.error('Error picking audio file', error);
    }
  };

  const handleTranscribe = async () => {
    if (!audioFileUri) return;

    setIsTranscribing(true);
    setTranscriptionText(null);
    setErrorMessage(null);
    setProgress('Starting...');

    try {
      const result = await transcribeAudio(audioFileUri, (message, _percent) => {
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

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      {/* Upload Section */}
      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Upload Audio</ThemedText>

        <Pressable onPress={pickAudioAsync} style={styles.selectButton}>
          <ThemedText style={styles.selectButtonText}>
            {audioFileName ? `📎 ${audioFileName}` : '🎵 Select an Audio File'}
          </ThemedText>
        </Pressable>

        {audioFileName && !isTranscribing && (
          <Pressable onPress={handleTranscribe} style={styles.transcribeButton}>
            <ThemedText style={styles.transcribeButtonText}>
              Upload & Transcribe
            </ThemedText>
          </Pressable>
        )}

        {isTranscribing && (
          <ThemedView style={styles.progressContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
            <ThemedText style={styles.progressText}>{progress}</ThemedText>
          </ThemedView>
        )}
      </ThemedView>

      {/* Error Display */}
      {errorMessage && (
        <ThemedView style={styles.stepContainer}>
          <ThemedText style={styles.errorText}>⚠️ {errorMessage}</ThemedText>
        </ThemedView>
      )}

      {/* Transcription Result */}
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
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
  },
  resultContainer: {
    gap: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
  },
  resultScroll: {
    maxHeight: 400,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 22,
  },
});
