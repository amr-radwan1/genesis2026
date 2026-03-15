import { useState, useCallback, useEffect } from 'react';
import { startLiveTranscription, stopLiveTranscription } from '@/services/whisper-service';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';


export function useWhisper() {
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [status, setStatus] = useState('');

  // Auto-cleanup on unmount if it was left running
  useEffect(() => {
    return () => {
      deactivateKeepAwake();
      stopLiveTranscription().catch(console.error);
    };
  }, []);

  const handleStart = useCallback(async (onTextUpdate?: (text: string) => void) => {
    try {
      await activateKeepAwakeAsync();
      await startLiveTranscription(
        (text) => {
          setCurrentTranscript(text);
          onTextUpdate?.(text);
        },
        (statusMsg) => {
          setStatus(statusMsg);
        }
      );
    } catch (e) {
      console.error('Error starting live transcription:', e);
      setStatus('Error starting transcription');
      throw e;
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      deactivateKeepAwake();
      await stopLiveTranscription();
    } catch (e) {
      console.error('Error stopping live transcription:', e);
      throw e;
    }
  }, []);

  return {
    startLiveTranscription: handleStart,
    stopLiveTranscription: handleStop,
    currentTranscript,
    status,
  };
}
