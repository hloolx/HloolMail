type SSEOptions = {
  apiKey?: string;
  signal?: AbortSignal;
  maxRetries?: number;
  retryDelay?: number;
};

export async function* sseStream<T = unknown>(url: string, options: SSEOptions = {}): AsyncGenerator<T> {
  const {
    apiKey,
    signal,
    maxRetries = 3,
    retryDelay = 1000
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) return;

    try {
      const headers = new Headers();
      if (apiKey) headers.set('X-API-Key', apiKey);
      const response = await fetch(url, {
        headers,
        signal,
        credentials: 'same-origin'
      });
      if (!response.ok) {
        if (attempt < maxRetries) {
          await delay(retryDelay * Math.pow(2, attempt));
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
        if (done) return;
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
      if (attempt < maxRetries && !signal?.aborted) {
        await delay(retryDelay * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
