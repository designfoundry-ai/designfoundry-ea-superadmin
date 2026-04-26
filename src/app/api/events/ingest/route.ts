import { createIngestHandler } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createIngestHandler();
