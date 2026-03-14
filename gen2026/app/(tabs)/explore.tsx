import React from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getNativeInferenceStatus } from '@/services/native-runtime';

export default function SetupScreen() {
  const status = getNativeInferenceStatus();

  return (
    <ThemedView style={styles.screen}>
      <ThemedView style={styles.card}>
        <ThemedText style={styles.title}>Setup</ThemedText>
        <ThemedText style={styles.body}>{status.reason}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText style={styles.subtitle}>Run the native build</ThemedText>
        <ThemedText style={styles.code}>npx expo prebuild --platform android</ThemedText>
        <ThemedText style={styles.code}>npx expo run:android</ThemedText>
        <ThemedText style={styles.code}>npx expo start --dev-client</ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText style={styles.subtitle}>Why this is needed</ThemedText>
        <ThemedText style={styles.body}>
          `whisper.rn` and `llama.rn` are native inference libraries. Expo Go cannot load them, so
          the lab screen stays safe and shows setup guidance until the app is running as a native
          dev build.
        </ThemedText>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5efe3',
    padding: 20,
    gap: 16,
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  title: {
    color: '#102a43',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#7c2d12',
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    color: '#334155',
    lineHeight: 22,
  },
  code: {
    color: '#0f766e',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
});
