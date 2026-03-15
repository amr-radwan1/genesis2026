import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

// ─── Subcomponent: Category Pill ───────────────────────────────────────────
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

// ─── Subcomponent: Note Card ────────────────────────────────────────────────
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
            <Text style={styles.aiBadgeText}>AI</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.iconBtn}>
          <Ionicons name={editing ? 'checkmark' : 'pencil'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {editing ? (
        <TextInput
          style={styles.cardInput}
          value={text}
          onChangeText={setText}
          onBlur={save}
          autoFocus
          multiline
          placeholderTextColor="#64748b"
        />
      ) : (
        <Text style={styles.cardText}>{note.text}</Text>
      )}
    </View>
  );
}

// ─── Subcomponent: Todo Card ────────────────────────────────────────────────
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
            <Ionicons name="checkmark-circle" size={24} color="#000000" />
          ) : (
            <Ionicons name="ellipse-outline" size={24} color="#475569" />
          )}
        </TouchableOpacity>

        {editing ? (
          <TextInput
            style={[styles.cardInput, { flex: 1 }]}
            value={text}
            onChangeText={setText}
            onBlur={save}
            autoFocus
            placeholderTextColor="#64748b"
          />
        ) : (
          <Text
            style={[styles.cardText, item.done && styles.cardTextDone, { flex: 1 }]}>
            {item.text}
          </Text>
        )}

        <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.iconBtn}>
          <Ionicons name={editing ? 'checkmark' : 'pencil'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {item.source === 'ai' && (
        <View style={[styles.aiBadge, { alignSelf: 'flex-start', marginTop: 6 }]}>
          <Text style={styles.aiBadgeText}>AI</Text>
        </View>
      )}
    </View>
  );
}

// ─── Subcomponent: Custom Card ──────────────────────────────────────────────
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
          <Ionicons name={editing ? 'checkmark' : 'pencil'} size={16} color="#94a3b8" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
      {editing ? (
        <View style={styles.customEditRow}>
          <TextInput
            style={[styles.cardInput, styles.customLabelInput]}
            value={label}
            onChangeText={setLabel}
            placeholder="Label"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.cardInput, { flex: 1 }]}
            value={value}
            onChangeText={setValue}
            onBlur={save}
            placeholder="Value"
            placeholderTextColor="#64748b"
            multiline
          />
        </View>
      ) : (
        <View>
          <Text style={styles.customLabel}>{entry.label}</Text>
          <Text style={styles.cardText}>{entry.value || '—'}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────
export default function MemoryScreen() {
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
    } else if (category === 'custom') {
      addCustomEntry(customLabel.trim() || 'Custom', trimmed);
      setCustomLabel('');
    }
    setInput('');
  }

  const inputPlaceholder =
    category === 'notes'
      ? 'Add a note...'
      : category === 'todos'
      ? 'Add a task...'
      : 'Enter value...';

  const isEmpty =
    (category === 'notes' && snap.notes.length === 0) ||
    (category === 'todos' && snap.todos.length === 0) ||
    (category === 'custom' && snap.customs.length === 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Memory</Text>
        <Text style={styles.subtitle}>Your context, organized</Text>
      </View>

      {/* Category Pills */}
      <View style={styles.pillRow}>
        <CategoryPill
          label="Notes"
          active={category === 'notes'}
          onPress={() => setCategory('notes')}
        />
        <CategoryPill
          label="Todos"
          active={category === 'todos'}
          onPress={() => setCategory('todos')}
        />
        <CategoryPill
          label="Custom"
          active={category === 'custom'}
          onPress={() => setCategory('custom')}
        />
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
                category === 'notes'
                  ? 'document-text-outline'
                  : category === 'todos'
                  ? 'checkbox-outline'
                  : 'construct-outline'
              }
              size={40}
              color="#334155"
            />
            <Text style={styles.emptyTitle}>
              {category === 'notes'
                ? 'No notes yet'
                : category === 'todos'
                ? 'No tasks yet'
                : 'No custom entries yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {category === 'custom'
                ? 'Add any key/value pairs you want the AI to remember.'
                : 'Add one below, or the AI will populate this from your transcriptions.'}
            </Text>
          </View>
        )}

        {category === 'notes' &&
          snap.notes.map((note) => (
            <NoteCard key={note.id} note={note} onDelete={() => deleteNote(note.id)} />
          ))}

        {category === 'todos' &&
          snap.todos.map((item) => (
            <TodoCard
              key={item.id}
              item={item}
              onDelete={() => deleteTodo(item.id)}
            />
          ))}

        {category === 'custom' &&
          snap.customs.map((entry) => (
            <CustomCard
              key={entry.id}
              entry={entry}
              onDelete={() => deleteCustomEntry(entry.id)}
            />
          ))}
      </ScrollView>

      {/* Input Bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <View style={styles.inputBar}>
          {category === 'custom' && (
            <TextInput
              style={[styles.textInput, styles.labelInput]}
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="Label"
              placeholderTextColor="#64748b"
            />
          )}
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { flex: 1 }]}
            value={input}
            onChangeText={setInput}
            placeholder={inputPlaceholder}
            placeholderTextColor="#64748b"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060d18',
  },
  header: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '500',
  },

  // Pills
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0e1a2b',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.15)',
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
    fontSize: 18,
    fontWeight: '700',
    color: '#475569',
  },
  emptyBody: {
    fontSize: 14,
    color: '#334155',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Cards
  card: {
    backgroundColor: '#0e1a2b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
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
    color: '#cbd5e1',
    lineHeight: 22,
    flexShrink: 1,
  },
  cardTextDone: {
    textDecorationLine: 'line-through',
    color: '#475569',
  },
  cardInput: {
    fontSize: 15,
    color: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.3)',
    paddingVertical: 2,
  },
  aiBadge: {
    backgroundColor: 'rgba(249,115,22,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#f97316',
    letterSpacing: 0.5,
  },
  iconBtn: {
    padding: 4,
  },
  checkbox: {
    padding: 2,
  },

  // Custom
  customEditRow: {
    gap: 8,
  },
  customLabelInput: {
    fontWeight: '700',
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f97316',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.1)',
    backgroundColor: '#060d18',
  },
  textInput: {
    backgroundColor: '#0e1a2b',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#f1f5f9',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.15)',
  },
  labelInput: {
    width: 100,
  },
  addBtn: {
    backgroundColor: '#000000',
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    opacity: 0.35,
  },
});
