// High-level facade — used by route handlers
import { publishToInstance, type PublishInput, type PublishResult } from './publisher';
import type { EventActor } from './envelope';

export { EventBusError, type EventBusMode, type PublishInput, type PublishResult } from './publisher';
export type { EventEnvelope, EventSeverity, EventActor } from './envelope';

export interface LicenseDeliveredPayload {
  licenseId: string;
  licenseBlob: string;
  plan: string;
  features: string[];
  maxUsers: number;
  maxObjects: number;
  expiresAt: string | null;
  [key: string]: unknown;
}

export interface DeliverLicenseInput {
  instanceId: string;
  tenantId?: string | null;
  payload: LicenseDeliveredPayload;
  actor?: EventActor;
}

export const EventBusService = {
  publishToInstance,

  async deliverLicense(input: DeliverLicenseInput): Promise<PublishResult> {
    return publishToInstance<LicenseDeliveredPayload>({
      instanceId: input.instanceId,
      tenantId: input.tenantId,
      eventType: 'license.delivered',
      severity: 'info',
      actor: input.actor,
      payload: input.payload,
    });
  },
} as const;

export type { PublishInput as EventBusPublishInput };

// Lower-level primitives — used by /api/events/ingest and direct callers.
// Re-exported under explicit names to avoid colliding with the facade above
// (both layers happen to use names like EventBusError / EventBusService).
export {
  generateEnvelopeId,
  signEnvelope,
  verifySignature,
  validateEnvelope,
  canonicalize,
} from './signing';
export { MemoryDriver, type MemoryEnvelope } from './drivers/memory.driver';
export { HttpDriver, type HttpDriverConfig } from './drivers/http.driver';
export { createIngestHandler } from './ingest';
export { dispatchToBridge, type BridgeContext } from './bridge';
export {
  ENVELOPE_VERSION,
  SEVERITY,
  EVENT_TYPES,
  type EventType,
  type Actor,
  type Severity,
  type PlatformEvent,
  type EventAttributes,
  type EventBusDriver,
  type IngestOutcome,
} from './types';
