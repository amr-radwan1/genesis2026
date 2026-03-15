import * as DocumentPicker from 'expo-document-picker';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
  useDerivedValue,
  useAnimatedProps,
} from 'react-native-reanimated';
import { useWhisper } from '@/hooks/use-whisper';
import { transcribeAudio } from '@/services/whisper-service';
import { isGemmaLoaded, extractMemoryFromTranscript } from '@/services/llm-service';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Constants for blob generation
const POINTS_COUNT = 8;
const RADIUS = 80;
const STEP = (Math.PI * 2) / POINTS_COUNT;

const SplineBlob = ({ isRecording }: { isRecording: boolean }) => {
  const time = useSharedValue(0);
  const recordingFactor = useSharedValue(0);

  useEffect(() => {
    // Continuous smooth oscillation
    time.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 5000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    // Animate "recording" intensity
    recordingFactor.value = withTiming(isRecording ? 1 : 0, {
      duration: 600,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [isRecording]);

  const pathData = useDerivedValue(() => {
    const points: { x: number; y: number }[] = [];
    // Base radius reduced to 55 for safety inside the new 340x340 container
    const BASE_RADIUS = 55;
    const intensity = 4 + recordingFactor.value * 8;
    const speed = 1.0; // Must be integer for 2π continuity

    for (let i = 0; i < POINTS_COUNT; i++) {
        const angle = i * STEP;
        const offset = 
            Math.sin(angle * 2 + time.value * speed) * intensity +
            Math.cos(angle * 3 - time.value * speed) * (intensity / 1.5);
        
        const r = BASE_RADIUS + offset;
        points.push({
            x: 170 + r * Math.cos(angle),
            y: 170 + r * Math.sin(angle),
        });
    }

    const startX = (points[0].x + points[1].x) / 2;
    const startY = (points[0].y + points[1].y) / 2;
    let d = `M ${startX} ${startY}`;

    for (let i = 1; i < points.length; i++) {
        const pControl = points[i];
        const pNext = points[(i + 1) % points.length];
        const endX = (pControl.x + pNext.x) / 2;
        const endY = (pControl.y + pNext.y) / 2;
        
        d += ` Q ${pControl.x} ${pControl.y}, ${endX} ${endY}`;
    }
    
    // Connect back seamlessly to the start
    d += ` Q ${points[0].x} ${points[0].y}, ${startX} ${startY} Z`;

    return d;
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: interpolate(recordingFactor.value, [0, 1], [1, 1.3]) }
      ],
      // Solid black matching the button exactly
      opacity: 1.0,
    };
  });

  return (
    <View style={styles.blobWrapper}>
      <Animated.View style={animatedStyle}>
        <Svg width="340" height="340" viewBox="0 0 340 340">
          <AnimatedPath
            animatedProps={useAnimatedProps(() => ({
              d: pathData.value,
            }))}
            fill="#000000"
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

// Minimum new characters before triggering a live memory extraction
const LIVE_EXTRACT_THRESHOLD = 400;

export default function RecordScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const { startLiveTranscription, stopLiveTranscription, currentTranscript } = useWhisper();
  const scrollViewRef = useRef<ScrollView>(null);
  const lastExtractedPosRef = useRef(0);

  // File upload state
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [audioFileUri, setAudioFileUri] = useState<string | null>(null);
  const [whisperBusy, setWhisperBusy] = useState(false);
  const [whisperProgress, setWhisperProgress] = useState('');
  const [fileTranscript, setFileTranscript] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }

    // Trigger memory extraction when enough new transcript has accumulated during live recording
    if (isRecording && isGemmaLoaded()) {
      const newChars = currentTranscript.length - lastExtractedPosRef.current;
      if (newChars >= LIVE_EXTRACT_THRESHOLD) {
        const segment = currentTranscript.slice(lastExtractedPosRef.current);
        lastExtractedPosRef.current = currentTranscript.length;
        extractMemoryFromTranscript(segment);
      }
    }
  }, [currentTranscript]);

  async function pickAudioAsync() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets?.length) {
        setAudioFileName(result.assets[0].name);
        setAudioFileUri(result.assets[0].uri);
        setFileTranscript('');
        setFileError(null);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Audio picker failed.');
    }
  }

  async function handleTranscribe() {
    if (!audioFileUri) {
      setFileError('Select a WAV file first.');
      return;
    }
    setWhisperBusy(true);
    setFileTranscript('');
    setFileError(null);
    try {
      const result = await transcribeAudio(audioFileUri, audioFileName ?? undefined, (message) => {
        setWhisperProgress(message);
      });
      setFileTranscript(result);
      // Auto-populate memory from the file transcript (fire-and-forget)
      if (isGemmaLoaded()) {
        extractMemoryFromTranscript(result);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Transcription failed.');
    } finally {
      setWhisperBusy(false);
    }
  }

  const toggleRecording = async () => {
    try {
      if (isRecording) {
        setIsRecording(false);
        await stopLiveTranscription();
        // Extract any remaining transcript that hasn't been processed yet
        const remaining = currentTranscript.slice(lastExtractedPosRef.current);
        if (remaining.trim() && isGemmaLoaded()) {
          extractMemoryFromTranscript(remaining);
        }
        lastExtractedPosRef.current = 0;
      } else {
        setIsRecording(true);
        await startLiveTranscription(() => {});
      }
    } catch (e: any) {
      console.error('Failed to toggle recording:', e);
      setIsRecording(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>EchoMind</Text>
        <Text style={styles.subtitle}>
          {isRecording ? 'Listening...' : 'Local Voice Interface'}
        </Text>
      </View>

      <View style={styles.centerArea}>
        <View style={styles.actionContainer}>
          <SplineBlob isRecording={isRecording} />
          
          <TouchableOpacity
            style={styles.mainAction}
            onPress={toggleRecording}
            activeOpacity={0.8}
          >
            <View style={styles.buttonIcon}>
              <Ionicons
                name={isRecording ? 'stop' : 'mic'}
                size={42}
                color="#ffffff"
              />
            </View>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.hintText}>
          {isRecording ? 'Recording in progress' : 'Tap to start listening'}
        </Text>
      </View>


      <View style={styles.transcriptSection}>
        <View style={styles.transcriptHeader}>
          <Text style={styles.transcriptLabel}>Realtime Transcript</Text>
          {isRecording && <View style={styles.pulseDot} />}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.transcriptScroll}
          contentContainerStyle={styles.transcriptInner}
          showsVerticalScrollIndicator={false}
        >
          {currentTranscript ? (
            <Text style={styles.textOutput}>
              {currentTranscript}
            </Text>
          ) : (
            <Text style={styles.emptyStateText}>
              Your spoken words will appear here as you speak...
            </Text>
          )}
        </ScrollView>
      </View>

      <View style={styles.uploadSection}>
        <View style={styles.uploadRow}>
          <TouchableOpacity
            style={[styles.uploadPickButton, audioFileName && styles.uploadPickButtonSelected]}
            onPress={pickAudioAsync}
            disabled={whisperBusy}
            activeOpacity={0.7}
          >
            <View style={styles.uploadPickIconWrap}>
              <Ionicons name="attach" size={16} color="#475569" />
            </View>
            <View style={styles.uploadPickMeta}>
              <Text style={styles.uploadPickLabel}>Attach audio file</Text>
              <Text style={styles.uploadPickFileName} numberOfLines={1}>
                {audioFileName ?? 'No file selected'}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uploadTranscribeButton, (!audioFileUri || whisperBusy) && styles.uploadDisabled]}
            onPress={handleTranscribe}
            disabled={!audioFileUri || whisperBusy}
            activeOpacity={0.7}
          >
            {whisperBusy ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.uploadTranscribeText}>Transcribe</Text>
            )}
          </TouchableOpacity>
        </View>
        {whisperBusy && whisperProgress ? (
          <Text style={styles.uploadStatus}>{whisperProgress}</Text>
        ) : null}
        {fileError ? (
          <Text style={styles.uploadError}>{fileError}</Text>
        ) : null}
        {fileTranscript ? (
          <View style={styles.fileTranscriptBox}>
            <Text style={styles.transcriptLabel}>File Transcript</Text>
            <ScrollView style={{ maxHeight: 100 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.textOutput}>{fileTranscript}</Text>
            </ScrollView>
          </View>
        ) : null}
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
    paddingTop: 40,
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1e293b',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 4,
    letterSpacing: 1,
  },
  centerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionContainer: {
    width: 340,
    height: 340,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  blobWrapper: {
    position: 'absolute',
    width: 340,
    height: 340,
    top: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainAction: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(30, 41, 59, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  buttonIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  hintText: {
    marginTop: 60,
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  transcriptSection: {
    height: 240,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#f8fafc',
    borderRadius: 32,
    padding: 24,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  transcriptScroll: {
    flex: 1,
  },
  transcriptInner: {
    paddingBottom: 20,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#94a3b8',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  textOutput: {
    fontSize: 16,
    color: '#334155',
    lineHeight: 24,
    fontWeight: '600',
  },
  uploadSection: {
    marginHorizontal: 20,
    marginBottom: 20,
    gap: 10,
  },
  uploadRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  uploadPickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  uploadPickButtonSelected: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  uploadPickIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadPickMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  uploadPickLabel: {
    fontSize: 11,
    lineHeight: 13,
    color: '#64748b',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  uploadPickFileName: {
    fontSize: 14,
    lineHeight: 18,
    color: '#0f172a',
    fontWeight: '600',
    marginTop: 2,
  },
  uploadTranscribeButton: {
    backgroundColor: '#000000',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadTranscribeText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  uploadDisabled: {
    opacity: 0.4,
  },
  uploadStatus: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  uploadError: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  fileTranscriptBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    gap: 8,
  },
});
