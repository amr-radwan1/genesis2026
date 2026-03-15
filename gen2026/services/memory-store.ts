/**
 * memory-store.ts
 *
 * Shared in-memory store for the Memory tab.
 * Eventually notes and todos will be auto-populated by the AI
 * from live transcriptions. For now, placeholder data is seeded.
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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const store: MemoryStore = {
  // ── Placeholder notes (will be AI-generated from transcriptions) ──────────
  notes: [
    {
      id: uid(),
      text: 'Discussed project timeline with Sarah — deadline pushed to end of April.',
      createdAt: Date.now() - 1000 * 60 * 30,
      source: 'ai',
    },
    {
      id: uid(),
      text: 'Key insight: users want faster onboarding, not more features.',
      createdAt: Date.now() - 1000 * 60 * 90,
      source: 'ai',
    },
    {
      id: uid(),
      text: 'Remember to follow up on the API credentials from the dev team.',
      createdAt: Date.now() - 1000 * 60 * 120,
      source: 'manual',
    },
  ],
  // ── Placeholder todos ─────────────────────────────────────────────────────
  todos: [
    {
      id: uid(),
      text: 'Review meeting notes from Tuesday standup',
      done: true,
      createdAt: Date.now() - 1000 * 60 * 200,
      source: 'ai',
    },
    {
      id: uid(),
      text: 'Send revised proposal doc to client by EOD',
      done: false,
      createdAt: Date.now() - 1000 * 60 * 60,
      source: 'ai',
    },
    {
      id: uid(),
      text: 'Book flight for conference in Austin',
      done: false,
      createdAt: Date.now() - 1000 * 60 * 45,
      source: 'manual',
    },
  ],
  // ── Placeholder custom entries ────────────────────────────────────────────
  customs: [
    {
      id: uid(),
      label: 'Primary Goal',
      value: 'Ship the MVP by end of Q2 with at least 3 beta users.',
      createdAt: Date.now() - 1000 * 60 * 300,
    },
    {
      id: uid(),
      label: 'Preferred Name',
      value: 'Alex',
      createdAt: Date.now() - 1000 * 60 * 500,
    },
    {
      id: uid(),
      label: 'Current Focus Area',
      value: 'On-device AI inference and voice-first UX.',
      createdAt: Date.now() - 1000 * 60 * 400,
    },
  ],
  listeners: new Set(),
};

function notify() {
  store.listeners.forEach((l) => l());
}

// ── Subscribe/Unsubscribe ──────────────────────────────────────────────────
export function subscribeMemory(listener: () => void) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

// ── Snapshots ──────────────────────────────────────────────────────────────
export function getMemorySnapshot() {
  return {
    notes: [...store.notes],
    todos: [...store.todos],
    customs: [...store.customs],
  };
}

// ── Notes ──────────────────────────────────────────────────────────────────
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

// ── Todos ──────────────────────────────────────────────────────────────────
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

// ── Custom ─────────────────────────────────────────────────────────────────
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
