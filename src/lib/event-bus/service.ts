import { MemoryDriver } from './drivers/memory.driver';
import { HttpDriver, type HttpDriverConfig } from './drivers/http.driver';
import { generateEnvelopeId, signEnvelope } from './signing';
import {
  ENVELOPE_VERSION,
  type Actor,
  type EventAttributes,
  type EventBusDriver,
  type PlatformEvent,
  type Severity,
} from './types';

declare global {
  // Reuse singleton across hot-reloads in dev.
  var _eventBusService: EventBusService | undefined;
}

export interface PublishInput {
  eventType: string;
  payload: Record<string, unknown>;
  severity?: Severity;
  tenantId?: string | null;
  actor?: Actor;
  /** Override default instance id (useful for downstream events). */
  instanceId?: string;
  /** Pub/Sub-style routing — only the named target instance should consume. */
  targetInstanceId?: string;
}

export interface EventBusServiceConfig {
  driver: EventBusDriver;
  signingSecret: string;
  signingKid: string;
  /** This deployment's own instance id; used as default envelope `instanceId`. */
  selfInstanceId: string;
}

/**
 * Singleton facade over the selected driver. Callers never construct
 * envelopes directly — they call `publish()` and the service handles ULID
 * generation, signing, and dispatch.
 */
export class EventBusService {
  private constructor(private readonly cfg: EventBusServiceConfig) {}

  static fromEnv(httpConfig?: HttpDriverConfig): EventBusService {
    if (globalThis._eventBusService) return globalThis._eventBusService;

    const driverName = (process.env.EVENT_BUS_DRIVER ?? 'memory').toLowerCase();
    const signingSecret =
      process.env.EVENT_BUS_SIGNING_SECRET ?? 'dev-secret-do-not-use-in-prod';
    const signingKid = process.env.EVENT_BUS_SIGNING_KID ?? 'dev-2026-04';
    const selfInstanceId =
      process.env.EVENT_BUS_INSTANCE_ID ?? 'superadmin';

    let driver: EventBusDriver;
    switch (driverName) {
      case 'http':
        if (!httpConfig) {
          throw new Error(
            'EVENT_BUS_DRIVER=http requires an HttpDriverConfig (resolveTarget)',
          );
        }
        driver = new HttpDriver({
          ...httpConfig,
          ingestSecret:
            httpConfig.ingestSecret ?? process.env.EVENT_BUS_INGEST_SECRET,
        });
        break;
      case 'memory':
      default:
        driver = new MemoryDriver();
        break;
    }

    const service = new EventBusService({
      driver,
      signingSecret,
      signingKid,
      selfInstanceId,
    });
    if (process.env.NODE_ENV !== 'production') {
      globalThis._eventBusService = service;
    }
    return service;
  }

  /** Test/factory helper — explicit construction. */
  static create(cfg: EventBusServiceConfig): EventBusService {
    return new EventBusService(cfg);
  }

  get driver(): EventBusDriver {
    return this.cfg.driver;
  }

  async publish(input: PublishInput): Promise<PlatformEvent> {
    const envelope = signEnvelope(
      {
        id: generateEnvelopeId(),
        version: ENVELOPE_VERSION,
        instanceId: input.instanceId ?? this.cfg.selfInstanceId,
        tenantId: input.tenantId ?? null,
        eventType: input.eventType,
        severity: input.severity ?? 'info',
        actor: input.actor,
        payload: input.payload,
        timestamp: new Date().toISOString(),
      },
      this.cfg.signingSecret,
      this.cfg.signingKid,
    );

    const attrs: EventAttributes = {
      instanceId: envelope.instanceId,
      eventType: envelope.eventType,
      severity: envelope.severity,
      schemaVersion: envelope.version,
    };
    if (input.targetInstanceId) attrs.targetInstanceId = input.targetInstanceId;

    await this.cfg.driver.publish(envelope, attrs);
    return envelope;
  }

  async close(): Promise<void> {
    await this.cfg.driver.close();
    if (globalThis._eventBusService === this) {
      globalThis._eventBusService = undefined;
    }
  }
}

/** Convenience accessor for routes / server actions. */
export function getEventBus(httpConfig?: HttpDriverConfig): EventBusService {
  return EventBusService.fromEnv(httpConfig);
}
