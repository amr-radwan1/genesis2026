/**
 * memory-store.ts
 *
 * Simple in-memory store for the Memory tab.
 * Eventually this will be populated by AI from live transcriptions.
 */

export type Note = {
  id: string;
  text: string;
  createdAt: number;
  source: 'manual' | 'ai';
};

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  source: 'manual' | 'ai';
};

export type CustomEntry = {
  id: string;
  label: string;
  value: string;
  createdAt: number;
};

type MemoryStore = {
  notes: Note[];
  todos: TodoItem[];
  customs: CustomEntry[];
  listeners: Set<() => void>;
};

const store: MemoryStore = {
  notes: [],
  todos: [],
  customs: [],
  listeners: new Set(),
};

function notify() {
  store.listeners.forEach((l) => l());
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// --- Subscribe/Unsubscribe ---
export function subscribeMemory(listener: () => void) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

// --- Snapshots ---
export function getMemorySnapshot() {
  return {
    notes: [...store.notes],
    todos: [...store.todos],
    customs: [...store.customs],
  };
}

// --- Notes ---
export function addNote(text: string, source: Note['source'] = 'manual'): Note {
  const note: Note = { id: uid(), text, createdAt: Date.now(), source };
  store.notes.unshift(note);
  notify();
  return note;
}

export function updateNote(id: string, text: string) {
  const note = store.notes.find((n) => n.id === id);
  if (note) { note.text = text; notify(); }
}

export function deleteNote(id: string) {
  store.notes = store.notes.filter((n) => n.id !== id);
  notify();
}

// --- Todos ---
export function addTodo(text: string, source: TodoItem['source'] = 'manual'): TodoItem {
  const item: TodoItem = { id: uid(), text, done: false, createdAt: Date.now(), source };
  store.todos.unshift(item);
  notify();
  return item;
}

export function toggleTodo(id: string) {
  const item = store.todos.find((t) => t.id === id);
  if (item) { item.done = !item.done; notify(); }
}

export function updateTodo(id: string, text: string) {
  const item = store.todos.find((t) => t.id === id);
  if (item) { item.text = text; notify(); }
}

export function deleteTodo(id: string) {
  store.todos = store.todos.filter((t) => t.id !== id);
  notify();
}

// --- Custom ---
export function addCustomEntry(label: string, value: string): CustomEntry {
  const entry: CustomEntry = { id: uid(), label, value, createdAt: Date.now() };
  store.customs.unshift(entry);
  notify();
  return entry;
}

export function updateCustomEntry(id: string, label: string, value: string) {
  const entry = store.customs.find((c) => c.id === id);
  if (entry) { entry.label = label; entry.value = value; notify(); }
}

export function deleteCustomEntry(id: string) {
  store.customs = store.customs.filter((c) => c.id !== id);
  notify();
}
