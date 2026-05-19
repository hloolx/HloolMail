import React, { useCallback, useState } from 'react';

export interface JsonViewerProps {
  data: unknown;
  initiallyExpanded?: boolean;
  className?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

interface JsonNodeProps {
  value: unknown;
  isLast?: boolean;
  initiallyExpanded?: boolean;
}

const JsonNode: React.FC<JsonNodeProps> = ({
  value,
  isLast = true,
  initiallyExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const toggle = useCallback(() => setIsExpanded((prev) => !prev), []);

  if (value === null) {
    return (
      <span style={{ color: 'var(--muted)' }}>
        null
        {!isLast && ','}
      </span>
    );
  }

  if (value === undefined) {
    return (
      <span style={{ color: 'var(--muted)' }}>
        undefined
        {!isLast && ','}
      </span>
    );
  }

  const type = typeof value;

  if (type === 'boolean') {
    return (
      <span style={{ color: 'var(--muted)' }}>
        {String(value)}
        {!isLast && ','}
      </span>
    );
  }

  if (type === 'number') {
    return (
      <span style={{ color: 'var(--muted)' }}>
        {String(value)}
        {!isLast && ','}
      </span>
    );
  }

  if (type === 'string') {
    return (
      <span style={{ color: 'var(--good)' }}>
        {JSON.stringify(value)}
        {!isLast && ','}
      </span>
    );
  }

  if (type === 'bigint' || type === 'symbol' || type === 'function') {
    return (
      <span style={{ color: 'var(--muted)' }}>
        {`[${type}]`}
        {!isLast && ','}
      </span>
    );
  }

  if (isArray(value)) {
    if (value.length === 0) {
      return (
        <span style={{ color: 'var(--muted)' }}>
          []
          {!isLast && ','}
        </span>
      );
    }

    return (
      <>
        <button
          type="button"
          className="cursor-pointer select-none"
          style={{ color: 'var(--muted)', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
          onClick={toggle}
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'v' : '>'}[
        </button>
        {!isExpanded && (
          <span style={{ color: 'var(--muted)' }}>
            ... {value.length} items]
            {!isLast && ','}
          </span>
        )}
        {isExpanded && (
          <>
            {value.map((item, index) => (
              <div key={index} style={{ paddingLeft: '1.2rem' }}>
                <JsonNode
                  value={item}
                  isLast={index === value.length - 1}
                  initiallyExpanded={initiallyExpanded}
                />
              </div>
            ))}
            <div>
              <span style={{ color: 'var(--muted)' }}>]</span>
              {!isLast && (
                <span style={{ color: 'var(--muted)' }}>,</span>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return (
        <span style={{ color: 'var(--muted)' }}>
          {'{}'}
          {!isLast && ','}
        </span>
      );
    }

    return (
      <>
        <button
          type="button"
          className="cursor-pointer select-none"
          style={{ color: 'var(--muted)', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
          onClick={toggle}
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'v' : '>'}{'{'}
        </button>
        {!isExpanded && (
          <span style={{ color: 'var(--muted)' }}>
            ... {keys.length} items {'}'}
            {!isLast && ','}
          </span>
        )}
        {isExpanded && (
          <>
            {keys.map((key, index) => (
              <div key={key} style={{ paddingLeft: '1.2rem' }}>
                <span style={{ color: 'var(--focus)' }}>
                  {JSON.stringify(key)}
                </span>
                <span style={{ color: 'var(--muted)' }}>: </span>
                <JsonNode
                  value={value[key]}
                  isLast={index === keys.length - 1}
                  initiallyExpanded={initiallyExpanded}
                />
              </div>
            ))}
            <div>
              <span style={{ color: 'var(--muted)' }}>{'}'}</span>
              {!isLast && (
                <span style={{ color: 'var(--muted)' }}>,</span>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <span style={{ color: 'var(--muted)' }}>
      {String(value)}
      {!isLast && ','}
    </span>
  );
};

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  initiallyExpanded = false,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    let text: string;
    try {
      text = JSON.stringify(data, null, 2);
    } catch {
      text = String(data);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          fallbackCopy(text);
        });
    } else {
      fallbackCopy(text);
    }

    function fallbackCopy(str: string) {
      const textarea = document.createElement('textarea');
      textarea.value = str;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      }
      document.body.removeChild(textarea);
    }
  }, [data]);

  return (
    <div
      className={`relative max-h-96 overflow-auto rounded border border-[var(--border)] bg-[var(--panel)] p-3 ${className}`}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 rounded border border-[var(--border)] bg-[var(--soft)] px-2 py-1 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--background)]"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <div className="pr-14 font-mono text-xs">
        <JsonNode
          value={data}
          isLast={true}
          initiallyExpanded={initiallyExpanded}
        />
      </div>
    </div>
  );
};
