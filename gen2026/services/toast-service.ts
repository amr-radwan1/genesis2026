type ToastType = 'info' | 'success' | 'loading' | 'error';

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
};

type ToastListener = (toasts: Toast[]) => void;

class ToastService {
  private toasts: Toast[] = [];
  private listeners: Set<ToastListener> = new Set();

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l([...this.toasts]));
  }

  show(message: string, type: ToastType = 'info', duration: number = 3000): string {
    const id = Math.random().toString(36).substring(7);
    const toast: Toast = { id, message, type, duration };
    
    // If it's a loading toast, we might want to keep it until manually hidden
    this.toasts.push(toast);
    this.notify();

    if (duration > 0 && type !== 'loading') {
      setTimeout(() => this.hide(id), duration);
    }

    return id;
  }

  update(id: string, updates: Partial<Omit<Toast, 'id'>>) {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index !== -1) {
      this.toasts[index] = { ...this.toasts[index], ...updates };
      this.notify();
      
      if (updates.duration && updates.duration > 0 && updates.type !== 'loading') {
        setTimeout(() => this.hide(id), updates.duration);
      }
    }
  }

  hide(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }
}

export const toastService = new ToastService();
