type SSEOptions = {
  signal?: AbortSignal;
  maxRetries?: number;
  retryDelay?: number;
  maxRetryDelay?: number;
};

export class SSEAuthError extends Error {
  status: number;

  constructor(status: number) {
    super('SSE authentication failed');
    this.name = 'SSEAuthError';
    this.status = status;
  }
}

export async function* sseStream<T = unknown>(url: string, options: SSEOptions = {}): AsyncGenerator<T> {
  const {
    signal,
    maxRetries = 3,
    retryDelay = 1000,
    maxRetryDelay = 30000
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) return;

    try {
      const response = await fetch(url, {
        signal,
        credentials: 'same-origin'
      });
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('hlool:auth-expired'));
        throw new SSEAuthError(response.status);
      }
      if (!response.ok) {
        if (attempt < maxRetries) {
          await delay(backoffDelay(retryDelay, maxRetryDelay, attempt), signal);
          continue;
        }
        throw new Error(`SSE failed: ${response.status}`);
      }
      if (!response.body) throw new Error('SSE response has no body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error('SSE connection closed');
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) {
            try {
              yield JSON.parse(data) as T;
            } catch {
              // Skip malformed frame, continue processing subsequent events
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof SSEAuthError || signal?.aborted) throw err;
      if (attempt < maxRetries && !signal?.aborted) {
        await delay(backoffDelay(retryDelay, maxRetryDelay, attempt), signal);
        continue;
      }
      throw err;
    }
  }
}

function backoffDelay(baseDelay: number, maxDelay: number, attempt: number) {
  return Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}
