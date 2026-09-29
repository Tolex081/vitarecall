import { MemWal } from '@mysten-incubation/memwal';

const MAINNET_RELAYER = 'https://relayer.memory.walrus.xyz';

function serviceError(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function sanitizeUpstreamError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('MEMORY_')) return error;
  if ([401, 403].includes(error?.status)) {
    return serviceError('Walrus Memory rejected the server credentials. Check the account and delegate key.', 'MEMORY_AUTH_FAILED', 503);
  }
  if (error?.status === 429) {
    return serviceError('Walrus Memory is busy or the account quota is exhausted. Please try again later.', 'MEMORY_RATE_LIMITED', 503);
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.status === 504) {
    return serviceError('Walrus Memory took too long to respond. Check the receipt before retrying a save.', 'MEMORY_TIMEOUT', 504);
  }
  return serviceError('Walrus Memory could not complete the request. Check the connection and server configuration.', 'MEMORY_UNAVAILABLE');
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw serviceError(`${label} must contain 1 to ${maxLength.toLocaleString('en-US')} characters.`, 'MEMORY_INVALID_INPUT', 400);
  }
  return value.trim();
}

function requiredNamespace(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) {
    throw serviceError('A valid patient memory namespace is required.', 'MEMORY_INVALID_NAMESPACE', 400);
  }
  return value;
}

// The optional factory permits isolated tests without creating accounts or writing blobs.
export function createMemoryService(config = {}, { createClient = (settings) => MemWal.create(settings) } = {}) {
  const key = String(config.memwalKey || '').trim();
  const suppliedAccountId = String(config.memwalAccountId || '').trim();
  const accountId = /^[a-fA-F0-9]{64}$/.test(suppliedAccountId) ? `0x${suppliedAccountId}` : suppliedAccountId;
  const serverUrl = String(config.memwalUrl || MAINNET_RELAYER).trim().replace(/\/$/, '');
  const configured = Boolean(key && accountId);
  let client;

  function getClient() {
    if (!configured) {
      throw serviceError('Walrus Memory is not configured. Set MEMWAL_KEY and MEMWAL_ACCOUNT_ID on the server.', 'MEMORY_NOT_CONFIGURED', 503);
    }
    if (serverUrl !== MAINNET_RELAYER) {
      throw serviceError('This app requires the hosted mainnet relayer: https://relayer.memory.walrus.xyz.', 'MEMORY_INVALID_NETWORK', 503);
    }
    const supportedKey = /^(?:0x)?[a-fA-F0-9]{64}$/.test(key) || /^suiprivkey1[a-z0-9]{50,120}$/.test(key);
    if (!supportedKey || !/^0x[a-fA-F0-9]{64}$/.test(accountId)) {
      throw serviceError('Walrus Memory credentials have an invalid format. Use a hex or suiprivkey delegate key and a Sui account object ID.', 'MEMORY_INVALID_CREDENTIALS', 503);
    }
    client ??= createClient({ key, accountId, serverUrl, requestTimeoutMs: 30_000 });
    return client;
  }

  async function request(operation) {
    try {
      return await operation(getClient());
    } catch (error) {
      // Upstream errors may contain request text or internal details; never relay them.
      throw sanitizeUpstreamError(error);
    }
  }

  return {
    configured,
    network: 'mainnet',
    accountId: accountId || null,

    async submit(text, namespace) {
      const value = requiredText(text, 'Memory', 8000);
      const scope = requiredNamespace(namespace);
      return request(async (memory) => {
        const result = await memory.remember(value, scope);
        if (typeof result?.job_id !== 'string' || !result.job_id) {
          throw serviceError('Walrus Memory did not return a save receipt. Check the account before retrying.', 'MEMORY_INVALID_RECEIPT');
        }
        return { jobId: result.job_id, status: 'processing' };
      });
    },

    async receipt(jobId) {
      if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(jobId)) {
        throw serviceError('A valid memory job ID is required.', 'MEMORY_INVALID_JOB', 400);
      }
      return request(async (memory) => {
        const result = await memory.getRememberStatus(jobId);
        if (result?.status === 'done') {
          if (typeof result.blob_id !== 'string' || !result.blob_id) {
            throw serviceError('Walrus Memory completed the job without a blob ID. Check the receipt again.', 'MEMORY_INVALID_RECEIPT');
          }
          return { status: 'stored', blobId: result.blob_id, owner: result.owner || null };
        }
        if (result?.status === 'failed') {
          return { status: 'failed', error: 'Walrus Memory could not finish storing this memory. Review the relayer account before retrying.' };
        }
        if (result?.status === 'not_found') {
          return { status: 'failed', error: 'The relayer could not find this memory job. Check the account and original receipt before retrying.' };
        }
        if (['pending', 'running', 'uploaded'].includes(result?.status)) {
          // "uploaded" still awaits the relayer's final indexing/ownership steps.
          return { status: 'processing' };
        }
        throw serviceError('Walrus Memory returned an unrecognized job status.', 'MEMORY_INVALID_RECEIPT');
      });
    },

    async recall(query, namespace) {
      const value = requiredText(query, 'Query', 8000);
      const scope = requiredNamespace(namespace);
      return request(async (memory) => {
        const result = await memory.recall({ query: value, namespace: scope, limit: 6 });
        if (!Array.isArray(result?.results)) {
          throw serviceError('Walrus Memory returned an invalid recall result.', 'MEMORY_INVALID_RESPONSE');
        }
        return result.results
          .filter((entry) => typeof entry.blob_id === 'string' && entry.blob_id && typeof entry.text === 'string')
          .map((entry) => ({
            blobId: entry.blob_id,
            text: entry.text,
            createdAt: entry.created_at || null,
            distance: typeof entry.distance === 'number' ? entry.distance : null,
          }));
      });
    },

    async verify() {
      return request(async (memory) => {
        // Unlike health(), this is authenticated. It reads metadata without any write.
        await memory.listNamespaces({ limit: 1 });
        return { connected: true, network: 'mainnet', accountId };
      });
    },
  };
}
