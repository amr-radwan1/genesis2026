import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { checkAndAutoLoadGemma } from '@/services/llm-service';
import { ToastOverlay } from '@/components/ToastOverlay';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    checkAndAutoLoadGemma();
  }, []);

  return (
    <>
      <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#f1f5f9',
          height: Platform.OS === 'ios' ? 82 + insets.bottom : 66 + insets.bottom,
          paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 24 : 14),
          paddingTop: 0,
          elevation: 0,
        },
        tabBarItemStyle: {
          borderRadius: 12,
          marginHorizontal: 4,
          marginVertical: 2,
          paddingBottom: Platform.OS === 'android' ? 2 : 0,
        },
        tabBarIconStyle: {
          marginTop: Platform.OS === 'android' ? -1 : 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 0,
          marginBottom: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Record',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={32} name="mic.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'Memory',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={32} name="brain.head.profile" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={32} name="message.fill" color={color} />
          ),
        }}
      />
      </Tabs>
      <ToastOverlay />
    </>
  );
}
