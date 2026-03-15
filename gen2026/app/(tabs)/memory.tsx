import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getMemorySnapshot,
  subscribeMemory,
  addNote,
  updateNote,
  deleteNote,
  addTodo,
  toggleTodo,
  updateTodo,
  deleteTodo,
  addCustomEntry,
  updateCustomEntry,
  deleteCustomEntry,
  type Note,
  type TodoItem,
  type CustomEntry,
} from '@/services/memory-store';

type Category = 'notes' | 'todos' | 'custom';

// ─── Category Pill ──────────────────────────────────────────────────────────
function CategoryPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      activeOpacity={0.7}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Note Card ──────────────────────────────────────────────────────────────
function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);

  function save() {
    if (text.trim()) updateNote(note.id, text.trim());
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {note.source === 'ai' && (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>✦ AI</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.iconBtn}>
          <Ionicons name={editing ? 'checkmark' : 'pencil-outline'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {editing ? (
        <TextInput
          style={styles.cardEditInput}
          value={text}
          onChangeText={setText}
          onBlur={save}
          autoFocus
          multiline
          placeholderTextColor="#94a3b8"
        />
      ) : (
        <Text style={styles.cardText}>{note.text}</Text>
      )}
    </View>
  );
}

// ─── Todo Card ──────────────────────────────────────────────────────────────
function TodoCard({ item, onDelete }: { item: TodoItem; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);

  function save() {
    if (text.trim()) updateTodo(item.id, text.trim());
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <TouchableOpacity onPress={() => toggleTodo(item.id)} style={styles.checkbox}>
          {item.done ? (
            <Ionicons name="checkmark-circle" size={22} color="#000000" />
          ) : (
            <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
          )}
        </TouchableOpacity>

        {editing ? (
          <TextInput
            style={[styles.cardEditInput, { flex: 1 }]}
            value={text}
            onChangeText={setText}
            onBlur={save}
            autoFocus
            placeholderTextColor="#94a3b8"
          />
        ) : (
          <Text style={[styles.cardText, item.done && styles.cardTextDone, { flex: 1 }]}>
            {item.text}
          </Text>
        )}

        <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.iconBtn}>
          <Ionicons name={editing ? 'checkmark' : 'pencil-outline'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {item.source === 'ai' && (
        <View style={[styles.aiBadge, { alignSelf: 'flex-start', marginTop: 6 }]}>
          <Text style={styles.aiBadgeText}>✦ AI</Text>
        </View>
      )}
    </View>
  );
}

// ─── Custom Card ─────────────────────────────────────────────────────────────
function CustomCard({
  entry,
  onDelete,
}: {
  entry: CustomEntry;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.label);
  const [value, setValue] = useState(entry.value);

  function save() {
    if (label.trim()) updateCustomEntry(entry.id, label.trim(), value.trim());
    setEditing(false);
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.iconBtn}>
          <Ionicons name={editing ? 'checkmark' : 'pencil-outline'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            style={[styles.cardEditInput, { fontWeight: '700' }]}
            value={label}
            onChangeText={setLabel}
            placeholder="Label"
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            style={styles.cardEditInput}
            value={value}
            onChangeText={setValue}
            onBlur={save}
            placeholder="Value"
            placeholderTextColor="#94a3b8"
            multiline
          />
        </View>
      ) : (
        <>
          <Text style={styles.customLabel}>{entry.label}</Text>
          <Text style={styles.cardText}>{entry.value || '—'}</Text>
        </>
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<Category>('notes');
  const [snap, setSnap] = useState(getMemorySnapshot());
  const [input, setInput] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const unsubscribe = subscribeMemory(() => setSnap(getMemorySnapshot()));
    return () => { unsubscribe(); };
  }, []);

  function handleAdd() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (category === 'notes') {
      addNote(trimmed);
    } else if (category === 'todos') {
      addTodo(trimmed);
    } else {
      addCustomEntry(customLabel.trim() || 'Custom', trimmed);
      setCustomLabel('');
    }
    setInput('');
  }

  const inputPlaceholder =
    category === 'notes' ? 'Add a note...' :
    category === 'todos' ? 'Add a task...' :
    'Enter value...';

  const isEmpty =
    (category === 'notes' && snap.notes.length === 0) ||
    (category === 'todos' && snap.todos.length === 0) ||
    (category === 'custom' && snap.customs.length === 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 + insets.bottom : 0}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Memory</Text>
        <Text style={styles.subtitle}>Your context, organized</Text>
      </View>

      {/* Category pills */}
      <View style={styles.pillRow}>
        <CategoryPill label="Notes"  active={category === 'notes'}  onPress={() => setCategory('notes')} />
        <CategoryPill label="Todos"  active={category === 'todos'}  onPress={() => setCategory('todos')} />
        <CategoryPill label="Custom" active={category === 'custom'} onPress={() => setCategory('custom')} />
      </View>

      {/* List */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled">

        {isEmpty && (
          <View style={styles.emptyState}>
            <Ionicons
              name={
                category === 'notes'   ? 'document-text-outline' :
                category === 'todos'   ? 'checkbox-outline' :
                                         'construct-outline'
              }
              size={40}
              color="#e2e8f0"
            />
            <Text style={styles.emptyTitle}>
              {category === 'notes' ? 'No notes yet' :
               category === 'todos' ? 'No tasks yet' :
                                      'No custom entries yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {category === 'custom'
                ? 'Add key/value pairs you want the AI to remember.'
                : 'Add one below — the AI will populate this from your transcriptions.'}
            </Text>
          </View>
        )}

        {category === 'notes' && snap.notes.map((note) => (
          <NoteCard key={note.id} note={note} onDelete={() => deleteNote(note.id)} />
        ))}

        {category === 'todos' && snap.todos.map((item) => (
          <TodoCard key={item.id} item={item} onDelete={() => deleteTodo(item.id)} />
        ))}

        {category === 'custom' && snap.customs.map((entry) => (
          <CustomCard key={entry.id} entry={entry} onDelete={() => deleteCustomEntry(entry.id)} />
        ))}

      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        {category === 'custom' && (
          <TextInput
            style={[styles.textInput, { width: 100 }]}
            value={customLabel}
            onChangeText={setCustomLabel}
            placeholder="Label"
            placeholderTextColor="#94a3b8"
          />
        )}
        <TextInput
          ref={inputRef}
          style={[styles.textInput, { flex: 1 }]}
          value={input}
          onChangeText={setInput}
          placeholder={inputPlaceholder}
          placeholderTextColor="#94a3b8"
          onSubmitEditing={handleAdd}
          returnKeyType="done"
          multiline={false}
        />
        <TouchableOpacity
          onPress={handleAdd}
          style={[styles.addBtn, !input.trim() && styles.addBtnDisabled]}
          disabled={!input.trim()}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

// ─── Styles (light mode, matching the rest of the app) ──────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '500',
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pillActive: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  pillText: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 14,
  },
  pillTextActive: {
    color: '#ffffff',
  },

  // List
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#94a3b8',
  },
  emptyBody: {
    fontSize: 14,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Cards
  card: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    padding: 14,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardText: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
    flexShrink: 1,
  },
  cardTextDone: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },
  cardEditInput: {
    fontSize: 15,
    color: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 2,
  },
  aiBadge: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16a34a',
    letterSpacing: 0.3,
  },
  iconBtn: { padding: 4 },
  checkbox: { padding: 2 },

  // Custom
  customLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  textInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  addBtn: {
    backgroundColor: '#000000',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    opacity: 0.3,
  },
});
