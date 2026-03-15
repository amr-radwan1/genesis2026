import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, { 
  FadeInUp, 
  FadeOutUp, 
  Layout,
  SlideInUp,
  SlideOutUp
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { toastService, type Toast } from '@/services/toast-service';

export function ToastOverlay() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const unsubscribe = toastService.subscribe(setToasts);
    return () => { unsubscribe(); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <View style={[styles.container, { top: insets.top + 10 }]} pointerEvents="none">
      {toasts.map((toast) => (
        <Animated.View
          key={toast.id}
          entering={SlideInUp.springify().damping(15)}
          exiting={SlideOutUp}
          layout={Layout.springify()}
          style={[styles.toast, styles[toast.type]]}
        >
          <View style={styles.content}>
            {toast.type === 'loading' && (
              <ActivityIndicator size="small" color="#000" style={styles.icon} />
            )}
            {toast.type === 'success' && (
              <Ionicons name="checkmark-circle" size={20} color="#16a34a" style={styles.icon} />
            )}
            {toast.type === 'error' && (
              <Ionicons name="alert-circle" size={20} color="#dc2626" style={styles.icon} />
            )}
            {toast.type === 'info' && (
              <Ionicons name="information-circle" size={20} color="#2563eb" style={styles.icon} />
            )}
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 9999,
    alignItems: 'center',
    gap: 10,
  },
  toast: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    maxWidth: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 10,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  info: {},
  success: {
    borderColor: '#bbf7d0',
  },
  loading: {},
  error: {
    borderColor: '#fecaca',
  },
});
