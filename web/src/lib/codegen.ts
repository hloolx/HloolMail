export type CodeGenLang = 'curl' | 'fetch' | 'python';

export type CodeGenRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export function generateCode(request: CodeGenRequest, lang: CodeGenLang): string {
  switch (lang) {
    case 'curl':
      return generateCurl(request);
    case 'fetch':
      return generateFetch(request);
    case 'python':
      return generatePython(request);
    default:
      return '';
  }
}

export function codeGenLabel(lang: CodeGenLang): string {
  switch (lang) {
    case 'curl':
      return 'cURL';
    case 'fetch':
      return 'JavaScript';
    case 'python':
      return 'Python';
    default:
      return lang;
  }
}

function shellEscapeSingleQuotes(str: string): string {
  // In single-quoted shell strings, escape ' by ending quote, escaped quote, starting quote
  return str.replace(/'/g, "'\\''");
}

function generateCurl(request: CodeGenRequest): string {
  const parts: string[] = [];
  parts.push(`curl -X ${request.method.toUpperCase()}`);

  for (const [key, value] of Object.entries(request.headers)) {
    const escapedValue = shellEscapeSingleQuotes(value);
    parts.push(`-H '${key}: ${escapedValue}'`);
  }

  if (request.body) {
    const escapedBody = shellEscapeSingleQuotes(request.body);
    parts.push(`--data '${escapedBody}'`);
  }

  parts.push(`"${request.url}"`);

  return parts.join(' \\\n  ');
}

function generateFetch(request: CodeGenRequest): string {
  const options: Record<string, unknown> = {
    method: request.method.toUpperCase(),
  };

  if (Object.keys(request.headers).length > 0) {
    options.headers = request.headers;
  }

  if (request.body) {
    options.body = request.body;
  }

  const opts = JSON.stringify(options, null, 2);
  return `fetch("${request.url}", ${opts});`;
}

function generatePython(request: CodeGenRequest): string {
  const method = request.method.toUpperCase();
  const url = JSON.stringify(request.url);

  const headerEntries = Object.entries(request.headers);
  const headersArg =
    headerEntries.length > 0
      ? `headers=${JSON.stringify(request.headers)}`
      : '';

  let bodyArg = '';
  if (request.body) {
    const parsed = tryParseJson(request.body);
    if (parsed !== undefined) {
      bodyArg = `json=${jsonToPythonDict(parsed)}`;
    } else {
      bodyArg = `data=${JSON.stringify(request.body)}`;
    }
  }

  const parts: string[] = [];
  parts.push(`requests.request(${JSON.stringify(method)}, ${url}`);
  if (headersArg) parts.push(headersArg);
  if (bodyArg) parts.push(bodyArg);
  return parts.join(', ') + ')';
}

function tryParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function jsonToPythonDict(value: unknown, indent = 0): string {
  const spaces = ' '.repeat(indent);
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => jsonToPythonDict(v, indent + 2));
    return `[\n${items.map((item) => ' '.repeat(indent + 2) + item).join(',\n')},\n${spaces}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => {
      const key = /^[a-zA-Z_]\w*$/.test(k) ? k : JSON.stringify(k);
      return `${key}: ${jsonToPythonDict(v, indent + 2)}`;
    });
    return `{\n${items.map((item) => ' '.repeat(indent + 2) + item).join(',\n')},\n${spaces}}`;
  }
  return JSON.stringify(value);
}
