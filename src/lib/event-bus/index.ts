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
