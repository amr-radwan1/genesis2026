import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useWhisper } from '@/hooks/use-whisper';
import BackgroundService from '@/services/background-service';

export default function RecordScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const { startLiveTranscription, stopLiveTranscription, currentTranscript } = useWhisper();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Scroll to bottom as new text arrives
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [currentTranscript]);

  const toggleRecording = async () => {
    try {
      if (isRecording) {
        setIsRecording(false);
        await BackgroundService.stopService();
        await stopLiveTranscription();
      } else {
        setIsRecording(true);
        await BackgroundService.startService();
        await startLiveTranscription((text) => {
          // Transcript state is managed by the hook
        });
      }
    } catch (e: any) {
      console.error('Failed to toggle recording:', e);
      setIsRecording(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Transcription</Text>
        <Text style={styles.subtitle}>
          {isRecording ? 'Listening in background...' : 'Ready to record'}
        </Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.transcriptArea}
        contentContainerStyle={styles.transcriptContent}
      >
        {!currentTranscript ? (
          <Text style={styles.placeholderText}>
            Tap the microphone to start transcribing your surroundings...
          </Text>
        ) : (
          <Text style={styles.transcriptText}>{currentTranscript}</Text>
        )}
      </ScrollView>

      <View style={styles.controlArea}>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordingActive]}
          onPress={toggleRecording}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isRecording ? 'stop' : 'mic'}
            size={64}
            color="#ffffff"
          />
        </TouchableOpacity>
        <Text style={styles.statusText}>
          {isRecording ? 'Tap to Stop' : 'Tap to Start'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    padding: 24,
    paddingTop: 32,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  transcriptArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  transcriptContent: {
    padding: 24,
  },
  placeholderText: {
    fontSize: 18,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 28,
  },
  transcriptText: {
    fontSize: 20,
    color: '#334155',
    lineHeight: 32,
  },
  controlArea: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 16,
  },
  recordingActive: {
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
  },
});
