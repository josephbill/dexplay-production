type OperationFields = {
  status_code?: number;
  elapsed_ms?: number;
  error_type?: string;
  source?: 'local' | 'cloud' | 'offline_queue' | 'background_sync' | 'reviewer';
  offline?: boolean;
  enabled?: boolean;
  item_count?: number;
  attempt?: number;
  status?: string;
};

const SAFE_FIELDS = new Set<keyof OperationFields>([
  'status_code',
  'elapsed_ms',
  'error_type',
  'source',
  'offline',
  'enabled',
  'item_count',
  'attempt',
  'status',
]);

function isSafeSource(value: string): value is NonNullable<OperationFields['source']> {
  return value === 'local' ||
    value === 'cloud' ||
    value === 'offline_queue' ||
    value === 'background_sync' ||
    value === 'reviewer';
}

function safeFields(fields: OperationFields): OperationFields {
  const safe: OperationFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELDS.has(key as keyof OperationFields)) continue;
    if (key === 'offline' || key === 'enabled') {
      if (typeof value === 'boolean') safe[key] = value;
      continue;
    }
    if (
      key === 'status_code' ||
      key === 'elapsed_ms' ||
      key === 'item_count' ||
      key === 'attempt'
    ) {
      if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
      continue;
    }
    if (
      typeof value === 'string' &&
      value.length <= 80 &&
      /^[A-Za-z0-9_.-]+$/.test(value)
    ) {
      if (key === 'error_type') safe.error_type = value;
      if (key === 'status') safe.status = value;
      if (key === 'source' && isSafeSource(value)) safe.source = value;
    }
  }
  return safe;
}

export function logOperationEvent(
  operation: string,
  event: string,
  fields: OperationFields = {}
) {
  console.info(`[DexPlay operation] ${operation}.${event}`, {
    request_id: crypto.randomUUID(),
    ...safeFields(fields),
  });
}

export function startOperation(operation: string) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();

  const write = (
    level: 'info' | 'warn' | 'error',
    event: string,
    fields: OperationFields = {}
  ) => {
    console[level](`[DexPlay operation] ${operation}.${event}`, {
      request_id: requestId,
      ...safeFields(fields),
    });
  };

  write('info', 'started');

  return {
    requestId,
    event: (event: string, fields?: OperationFields) => write('info', event, fields),
    complete: (fields: OperationFields = {}) =>
      write('info', 'completed', {
        ...fields,
        elapsed_ms: Math.round(performance.now() - startedAt),
      }),
    fail: (error: unknown, fields: OperationFields = {}) =>
      write('error', 'failed', {
        ...fields,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        elapsed_ms: Math.round(performance.now() - startedAt),
      }),
  };
}
