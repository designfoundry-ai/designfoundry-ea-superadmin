import {
  EventBusError,
  type EventAttributes,
  type EventBusDriver,
  type PlatformEvent,
} from '../types';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INGEST_PATH = '/api/v1/superadmin/events/ingest';

export interface HttpDriverConfig {
  /**
   * Resolves the target HTTPS endpoint for a given envelope. The function
   * receives the envelope + attributes and may consult the instance registry
   * to find the URL.
   */
  resolveTarget(
    envelope: PlatformEvent,
    attrs: EventAttributes,
  ): Promise<string | null>;
  timeoutMs?: number;
  /** Per-target shared secret header (R1-14 §FR-9 dev fallback). Optional. */
  ingestSecret?: string;
}

/**
 * HTTP driver — POSTs envelopes directly to the target instance's ingest
 * endpoint. Used for:
 * 1. Superadmin → EA instance (license delivery, tenant lifecycle).
 * 2. Local dev where Pub/Sub isn't running.
 */
export class HttpDriver implements EventBusDriver {
  readonly name = 'http' as const;
  private closed = false;

  constructor(private readonly config: HttpDriverConfig) {}

  async publish(envelope: PlatformEvent, attrs: EventAttributes): Promise<void> {
    if (this.closed) {
      throw new EventBusError('http driver is closed', 'TRANSPORT_FAILURE');
    }
    const target = await this.config.resolveTarget(envelope, attrs);
    if (!target) {
      throw new EventBusError(
        `no target URL resolved for instance ${envelope.instanceId}`,
        'TRANSPORT_FAILURE',
      );
    }

    const url = target.endsWith('/')
      ? target.slice(0, -1) + DEFAULT_INGEST_PATH
      : target.includes('/api/')
        ? target
        : target + DEFAULT_INGEST_PATH;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Event-Type': envelope.eventType,
      'X-Envelope-Id': envelope.id,
      'X-Schema-Version': attrs.schemaVersion,
    };
    if (this.config.ingestSecret) {
      headers['X-Ingest-Secret'] = this.config.ingestSecret;
    }
    if (attrs.targetInstanceId) {
      headers['X-Target-Instance'] = attrs.targetInstanceId;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err: unknown) {
      const isAbort =
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name: string }).name === 'AbortError';
      throw new EventBusError(
        isAbort
          ? `publish to ${url} timed out`
          : `publish to ${url} failed: ${err instanceof Error ? err.message : 'unknown'}`,
        'TRANSPORT_FAILURE',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new EventBusError(
        `target rejected envelope (status ${response.status})`,
        'TRANSPORT_FAILURE',
      );
    }
  }

  async flush(): Promise<void> {
    // Per-call fetch — nothing buffered.
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
