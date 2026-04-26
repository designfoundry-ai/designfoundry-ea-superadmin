import { getInstance } from '../services/instance-registry';
import { buildEnvelope, type EventEnvelope, type EventSeverity, type EventActor } from './envelope';

export type EventBusMode = 'pubsub' | 'direct' | 'disabled';

export class EventBusError extends Error {
  constructor(
    message: string,
    public code: 'INSTANCE_INACTIVE' | 'NO_SECRET' | 'TRANSPORT' | 'CONFIG',
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'EventBusError';
  }
}

export interface PublishInput<TPayload> {
  instanceId: string;
  tenantId?: string | null;
  eventType: string;
  payload: TPayload;
  severity?: EventSeverity;
  actor?: EventActor;
}

export interface PublishResult {
  ok: boolean;
  mode: EventBusMode;
  envelopeId: string;
  messageId?: string;
}

const INGEST_PATH = '/api/v1/superadmin/events/ingest';
const DEFAULT_TIMEOUT_MS = 5000;

function getMode(): EventBusMode {
  const v = (process.env.EVENT_BUS_MODE ?? 'direct').toLowerCase();
  if (v === 'pubsub' || v === 'direct' || v === 'disabled') return v;
  return 'direct';
}

function getSigningSecret(): string {
  const secret = process.env.EVENT_BUS_SIGNING_SECRET;
  if (!secret) {
    throw new EventBusError(
      'EVENT_BUS_SIGNING_SECRET is not set',
      'NO_SECRET',
    );
  }
  return secret;
}

function getSigningKid(): string {
  return process.env.EVENT_BUS_SIGNING_KID ?? 'superadmin-2026-01';
}

/**
 * Publish a platform event addressed to a specific EA instance.
 * Resolves the instance from the registry, builds + signs the envelope,
 * and dispatches via the configured transport.
 */
export async function publishToInstance<TPayload extends Record<string, unknown>>(
  input: PublishInput<TPayload>,
): Promise<PublishResult> {
  const mode = getMode();

  if (mode === 'disabled') {
    return { ok: true, mode, envelopeId: 'disabled' };
  }

  const instance = await getInstance(input.instanceId);
  if (instance.status === 'deactivated') {
    throw new EventBusError(
      `instance ${input.instanceId} is deactivated`,
      'INSTANCE_INACTIVE',
    );
  }

  const envelope = buildEnvelope({
    instanceId: instance.id,
    tenantId: input.tenantId,
    eventType: input.eventType,
    severity: input.severity ?? 'info',
    actor: input.actor,
    payload: input.payload,
    signingSecret: getSigningSecret(),
    signatureKid: getSigningKid(),
  });

  if (mode === 'pubsub') {
    const messageId = await publishViaPubSub(envelope);
    return { ok: true, mode, envelopeId: envelope.id, messageId };
  }

  await publishViaDirectHttp(instance.url, envelope);
  return { ok: true, mode, envelopeId: envelope.id };
}

interface PubSubTopicLike {
  publishMessage(args: {
    data: Buffer;
    attributes: Record<string, string>;
  }): Promise<string>;
}

interface PubSubClientLike {
  topic(name: string): PubSubTopicLike;
}

interface PubSubModuleLike {
  PubSub: new () => PubSubClientLike;
}

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

async function publishViaPubSub<T>(envelope: EventEnvelope<T>): Promise<string> {
  const topicName = process.env.EVENT_BUS_TOPIC ?? 'platform-events';

  let mod: PubSubModuleLike;
  try {
    mod = (await dynamicImport('@google-cloud/pubsub')) as PubSubModuleLike;
  } catch (err) {
    throw new EventBusError(
      '@google-cloud/pubsub is not installed; set EVENT_BUS_MODE=direct or install the package',
      'CONFIG',
      err,
    );
  }

  try {
    const client = new mod.PubSub();
    const topic = client.topic(topicName);
    return await topic.publishMessage({
      data: Buffer.from(JSON.stringify(envelope)),
      attributes: {
        instanceId: envelope.instanceId,
        eventType: envelope.eventType,
        severity: envelope.severity,
        schemaVersion: envelope.version,
      },
    });
  } catch (err) {
    throw new EventBusError(
      `Pub/Sub publish failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      'TRANSPORT',
      err,
    );
  }
}

async function publishViaDirectHttp<T>(
  instanceUrl: string,
  envelope: EventEnvelope<T>,
): Promise<void> {
  const sharedSecret = process.env.DEV_INGEST_SECRET;
  if (!sharedSecret) {
    throw new EventBusError(
      'DEV_INGEST_SECRET is required for EVENT_BUS_MODE=direct',
      'CONFIG',
    );
  }

  const url = instanceUrl.replace(/\/+$/, '') + INGEST_PATH;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': sharedSecret,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new EventBusError(
        `direct ingest returned ${response.status} ${response.statusText}`,
        'TRANSPORT',
      );
    }
  } catch (err) {
    if (err instanceof EventBusError) throw err;
    throw new EventBusError(
      `direct ingest failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      'TRANSPORT',
      err,
    );
  } finally {
    clearTimeout(timeout);
  }
}
