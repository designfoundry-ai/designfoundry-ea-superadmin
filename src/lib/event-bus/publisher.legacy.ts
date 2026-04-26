import {
  getDecryptedKeys,
  getInstance,
  listInstances,
} from '../services/instance-registry';
import { HttpDriver } from './drivers/http.driver';
import { generateEnvelopeId, signEnvelope } from './signing';
import {
  ENVELOPE_VERSION,
  EventBusError,
  type Actor,
  type EventAttributes,
  type PlatformEvent,
  type Severity,
} from './types';

export interface PublishToInstanceInput {
  /** Registry UUID of the target EA instance. */
  instanceId: string;
  eventType: string;
  payload: Record<string, unknown>;
  severity?: Severity;
  tenantId?: string | null;
  actor?: Actor;
}

const SUPERADMIN_INSTANCE_ID =
  process.env.EVENT_BUS_INSTANCE_ID ?? 'superadmin';
const SIGNING_KID = process.env.EVENT_BUS_SIGNING_KID ?? 'superadmin-2026-04';

/**
 * Publish a single envelope TO a specific EA instance. The envelope is signed
 * with the instance's API key (the same secret the instance uses to call
 * superadmin endpoints) so the receiving instance can verify it with the key
 * it already holds.
 */
export async function publishToInstance(
  input: PublishToInstanceInput,
): Promise<PlatformEvent> {
  const instance = await getInstance(input.instanceId);
  if (instance.status === 'deactivated') {
    throw new EventBusError(
      `instance ${instance.id} is deactivated`,
      'INACTIVE_INSTANCE',
    );
  }
  const keys = await getDecryptedKeys(instance.id);
  const signingSecret = keys.active ?? keys.pending;
  if (!signingSecret) {
    throw new EventBusError(
      `instance ${instance.id} has no API key — cannot sign outbound event`,
      'INACTIVE_INSTANCE',
    );
  }

  const envelope = signEnvelope(
    {
      id: generateEnvelopeId(),
      version: ENVELOPE_VERSION,
      instanceId: SUPERADMIN_INSTANCE_ID,
      tenantId: input.tenantId ?? null,
      eventType: input.eventType,
      severity: input.severity ?? 'info',
      actor: input.actor,
      payload: input.payload,
      timestamp: new Date().toISOString(),
    },
    signingSecret,
    SIGNING_KID,
  );

  const attrs: EventAttributes = {
    instanceId: envelope.instanceId,
    eventType: envelope.eventType,
    severity: envelope.severity,
    schemaVersion: envelope.version,
    targetInstanceId: instance.id,
  };

  const driver = new HttpDriver({
    resolveTarget: async () => instance.url,
    timeoutMs: 5000,
  });
  try {
    await driver.publish(envelope, attrs);
  } finally {
    await driver.close();
  }
  return envelope;
}

/**
 * Fan-out variant: publish the same logical event to every active instance.
 * Used for broadcast scenarios (e.g. a new content pack release). Failures
 * per instance are returned in the result; one failed instance does not stop
 * the others.
 */
export async function publishToAllInstances(
  input: Omit<PublishToInstanceInput, 'instanceId'>,
): Promise<{
  delivered: PlatformEvent[];
  failed: { instanceId: string; error: string }[];
}> {
  const instances = await listInstances();
  const delivered: PlatformEvent[] = [];
  const failed: { instanceId: string; error: string }[] = [];

  await Promise.all(
    instances
      .filter((i) => i.status !== 'deactivated')
      .map(async (i) => {
        try {
          const env = await publishToInstance({ ...input, instanceId: i.id });
          delivered.push(env);
        } catch (err) {
          failed.push({
            instanceId: i.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      }),
  );
  return { delivered, failed };
}
