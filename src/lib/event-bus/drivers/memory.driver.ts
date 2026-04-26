import type {
  EventAttributes,
  EventBusDriver,
  PlatformEvent,
} from '../types';

export interface MemoryEnvelope {
  envelope: PlatformEvent;
  attrs: EventAttributes;
  publishedAt: number;
}

/**
 * In-process driver for development and tests. Buffers published envelopes
 * in memory and exposes them for inspection.
 *
 * NOT for production. Multi-process / multi-pod deployments will not see
 * each other's events.
 */
export class MemoryDriver implements EventBusDriver {
  readonly name = 'memory' as const;
  private buffer: MemoryEnvelope[] = [];
  private readonly listeners = new Set<(env: MemoryEnvelope) => void>();
  private readonly capacity: number;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
  }

  async publish(envelope: PlatformEvent, attrs: EventAttributes): Promise<void> {
    const item: MemoryEnvelope = {
      envelope,
      attrs,
      publishedAt: Date.now(),
    };
    this.buffer.push(item);
    if (this.buffer.length > this.capacity) {
      this.buffer = this.buffer.slice(-this.capacity);
    }
    for (const listener of this.listeners) {
      try {
        listener(item);
      } catch {
        // Listener errors must not break publish.
      }
    }
  }

  async flush(): Promise<void> {
    // Memory driver is synchronous; nothing to flush.
  }

  async close(): Promise<void> {
    this.listeners.clear();
    this.buffer = [];
  }

  /** Test helper — drain the buffer. */
  drain(): MemoryEnvelope[] {
    const items = this.buffer;
    this.buffer = [];
    return items;
  }

  /** Test helper — peek without consuming. */
  peek(): readonly MemoryEnvelope[] {
    return this.buffer;
  }

  on(listener: (env: MemoryEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
