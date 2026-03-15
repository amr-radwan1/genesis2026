import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import {
  isModelDownloaded,
  downloadGemmaModel,
  loadGemmaModel,
  isGemmaLoaded,
  sendGemmaMessage,
  ChatMessage,
} from '@/services/llm-service';
import { getMemorySnapshot } from '@/services/memory-store';

const MEMORY_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'to', 'of', 'in', 'on', 'for',
  'with', 'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this',
  'that', 'these', 'those', 'as', 'about', 'into', 'over', 'after', 'before', 'between',
  'you', 'your', 'i', 'we', 'they', 'he', 'she', 'them', 'our', 'my', 'me', 'do', 'does', 'did',
  'can', 'could', 'should', 'would', 'what', 'when', 'where', 'why', 'how', 'please', 'tell',
  'explain', 'summarize', 'summary', 'audio', 'recording', 'transcript'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !MEMORY_STOP_WORDS.has(token));
}

function getOverlapScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0;

  const textTokens = new Set(tokenize(text));
  let score = 0;
  queryTokens.forEach((token) => {
    if (textTokens.has(token)) {
      score += 1;
    }
  });

  return score;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const androidInputOffset = Platform.OS === 'android' ? Math.max(8, tabBarHeight - 64) : 0;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Checking model...');
  const [isGenerating, setIsGenerating] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function initializeLLM() {
      try {
        if (isGemmaLoaded()) {
          setIsReady(true);
          return;
        }

        const downloaded = await isModelDownloaded();
        if (!downloaded) {
          setLoadingStatus('Downloading Gemma 3 (1.5GB)... This may take a while.');
          await downloadGemmaModel((status, percent) => {
            setLoadingStatus(`Downloading: ${percent}%`);
          });
        }

        setLoadingStatus('Loading model into memory...');
        await loadGemmaModel();
        setIsReady(true);
      } catch (e: any) {
        setLoadingStatus(`Error: ${e.message}`);
      }
    }

    initializeLLM();
  }, []);

  function buildMemorySystemMessage(userInput: string): ChatMessage | null {
    const { notes, todos, customs } = getMemorySnapshot();
    const queryTokens = new Set(tokenize(userInput));

    const scoredNotes = notes
      .map((n) => ({ item: n, score: getOverlapScore(queryTokens, n.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
      .slice(0, 5)
      .map((x) => x.item);

    const scoredTodos = todos
      .map((t) => ({ item: t, score: getOverlapScore(queryTokens, t.text) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
      .slice(0, 4)
      .map((x) => x.item);

    const scoredCustoms = customs
      .map((c) => ({ item: c, score: getOverlapScore(queryTokens, `${c.label} ${c.value}`) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
      .slice(0, 4)
      .map((x) => x.item);

    const parts: string[] = [];

    if (scoredNotes.length > 0) {
      parts.push('Relevant Notes:\n' + scoredNotes.map((n) => `- ${n.text}`).join('\n'));
    }
    if (scoredTodos.length > 0) {
      parts.push(
        'Relevant Todos:\n' +
          scoredTodos.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n'),
      );
    }
    if (scoredCustoms.length > 0) {
      parts.push('Relevant Key Facts:\n' + scoredCustoms.map((c) => `- ${c.label}: ${c.value}`).join('\n'));
    }

    if (parts.length === 0) return null;

    return {
      role: 'system',
      content:
        "You are a helpful AI assistant. Use ONLY the memory items below if they are directly relevant to the user's current request. If not relevant, ignore them completely and answer from general knowledge. Never force unrelated memory into the answer.\n\n" +
        parts.join('\n\n'),
    };
  }

  const handleSend = async () => {
    if (!input.trim() || !isReady || isGenerating) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsGenerating(true);

    try {
      const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
      setMessages([...newMessages, assistantMessage]);

      const systemMsg = buildMemorySystemMessage(userMessage.content);
      const messagesForModel: ChatMessage[] = systemMsg
        ? [systemMsg, ...newMessages]
        : newMessages;

      await sendGemmaMessage(messagesForModel, (token) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = token;
          }
          return updated;
        });
      });
    } catch (e: any) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: `Error: ${e.message}` },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f97316" />
        <Text style={styles.loadingText}>{loadingStatus}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 + insets.bottom : 0}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>EchoMind Assistant</Text>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.chatArea}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>Ask me anything or paste your transcript!</Text>
          ) : (
            messages.map((msg, idx) => (
              <View
                key={idx}
                style={[
                  styles.messageBubble,
                  msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  msg.role === 'system' && styles.systemBubble,
                ]}>
                <Text
                  style={[
                    styles.messageText,
                    msg.role === 'user' ? styles.userText : styles.assistantText,
                    msg.role === 'system' && styles.systemText,
                  ]}>
                  {msg.content}
                </Text>
              </View>
            ))
          )}
          {isGenerating && (
            <Text style={styles.generatingIndicator}>Generating...</Text>
          )}
        </ScrollView>

        <View style={[styles.inputArea, { marginBottom: androidInputOffset }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#94a3b8"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || isGenerating) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || isGenerating}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    color: '#475569',
    fontSize: 16,
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 20,
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 40,
    fontSize: 15,
  },
  messageBubble: {
    padding: 14,
    borderRadius: 20,
    maxWidth: '85%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#000000',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
    borderBottomLeftRadius: 4,
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: '#fee2e2',
    maxWidth: '100%',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: '#ffffff',
  },
  assistantText: {
    color: '#334155',
  },
  systemText: {
    color: '#991b1b',
    fontSize: 13,
  },
  generatingIndicator: {
    color: '#94a3b8',
    fontSize: 13,
    fontStyle: 'italic',
    marginLeft: 10,
  },
  inputArea: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: '#0f172a',
  },
  sendButton: {
    backgroundColor: '#000000',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#475569',
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});
