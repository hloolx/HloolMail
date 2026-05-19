import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle, Check, Code, Copy, Globe, History,
  Play, Send, Terminal, ChevronDown
} from 'lucide-react';
import type { InstallStatus } from '../api';
import { api } from '../api';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { copy } from '../lib/clipboard';
import {
  API_DOC_ENDPOINTS,
  API_DOCS_MD_PATH,
  API_SKILL_MD_PATH,
  apiDocMarkdown,
  apiSkillPrompt,
  endpointDesc,
  endpointTitle,
  explorerDefaults,
  type DocEndpoint
} from '../lib/apiDocs';
import { useRequestHistory } from '../hooks/useRequestHistory';
import { generateCode, codeGenLabel, type CodeGenLang } from '../lib/codegen';
import { ParamBuilder } from '../components/api-explorer/ParamBuilder';
import { ResponsePanel, type ExplorerResult } from '../components/api-explorer/ResponsePanel';
import { ApiKeySelector } from '../components/api-explorer/ApiKeySelector';
import { InfoTip } from '../components/shared';
import { ConfirmModal } from '../components/api-explorer/ConfirmModal';
import { ApiDocsHero } from './ApiDocsHero';
import { ApiDocsHistory } from './ApiDocsHistory';
import { ApiDocsMarkdownPreview } from './ApiDocsMarkdownPreview';

function endpointKey(endpoint: DocEndpoint) {
  return `${endpoint.method} ${endpoint.path}`;
}

function prettyBody(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function normalizePath(path: string) {
  const value = path.trim() || '/api/domains/available';
  return value.startsWith('/') ? value : `/${value}`;
}

function buildRequestURL(apiBase: string, requestPath: string, queryString: string, fallbackBase: string, fallbackPath: string): URL | null {
  try {
    const url = new URL(normalizePath(requestPath), (apiBase || fallbackBase).replace(/\/$/, ''));
    const query = queryString.trim().replace(/^\?/, '');
    if (query) {
      new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
    }
    return url;
  } catch {
    return null;
  }
}

function requestPreview(endpoint: DocEndpoint, url: URL, apiKey: string, body: string) {
  const lines = [`${endpoint.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`];
  if (endpoint.auth === 'apiKey') {
    lines.push(`X-API-Key: ${apiKey.trim() ? 'YOUR_KEY' : '<required>'}`);
  }
  if (body.trim() && endpoint.method !== 'GET') {
    lines.push('Content-Type: application/json', '', body.trim());
  }
  return lines.join('\n');
}

const CODE_GEN_LANGUAGES: CodeGenLang[] = ['curl', 'fetch', 'python'];

export function APIDocsPage() {
  const text = useText();
  const language = useAppStore((state) => state.language);
  const browserBaseURL = window.location.origin;
  const installStatus = useQuery({ queryKey: ['install-status'], queryFn: () => api<InstallStatus>('/api/install/status'), retry: false });
  const config = installStatus.data?.config;
  const configuredBaseURL = (config?.public_base_url || browserBaseURL).replace(/\/$/, '');
  const markdownURL = new URL(API_DOCS_MD_PATH, configuredBaseURL).href;
  const skillURL = new URL(API_SKILL_MD_PATH, configuredBaseURL).href;
  const docs = useQuery({
    queryKey: ['api-docs-md', configuredBaseURL],
    queryFn: async () => {
      const response = await fetch(API_DOCS_MD_PATH, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.statusText);
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const body = await response.text();
      const trimmed = body.trimStart().toLowerCase();
      if (contentType.includes('text/html') || trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
        throw new Error('api docs endpoint returned html');
      }
      return body;
    },
    retry: false
  });
  const markdown = docs.data || apiDocMarkdown(configuredBaseURL, config);

  const defaultEndpoint = API_DOC_ENDPOINTS[0];
  const defaultRequest = explorerDefaults(defaultEndpoint);
  const [selectedKey, setSelectedKey] = useState(endpointKey(defaultEndpoint));
  const [apiBase, setApiBase] = useState(browserBaseURL);
  const [apiKey, setApiKey] = useState('');
  const [requestPath, setRequestPath] = useState(defaultRequest.path);
  const [queryString, setQueryString] = useState(defaultRequest.query);
  const [requestBody, setRequestBody] = useState(defaultRequest.body);
  const [dangerConfirmed, setDangerConfirmed] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [callError, setCallError] = useState('');
  const [duration, setDuration] = useState(0);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [showCodeGen, setShowCodeGen] = useState(false);
  const [codeGenLang, setCodeGenLang] = useState<CodeGenLang>('curl');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [endpointMenuOpen, setEndpointMenuOpen] = useState(false);
  const endpointSelectRef = useRef<HTMLDivElement>(null);
  const { history, addEntry, removeEntry, restoreEntry, clearHistory, storageError } = useRequestHistory();

  useEffect(() => {
    setApiBase((current) => (current === browserBaseURL ? configuredBaseURL : current));
  }, [browserBaseURL, configuredBaseURL]);

  useEffect(() => {
    if (storageError) {
      toast.warning('History storage is full or unavailable. Recent requests may not be saved.', {
        id: 'history-storage-error',
      });
    }
  }, [storageError]);

  useEffect(() => {
    if (!endpointMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (endpointSelectRef.current?.contains(event.target as Node)) return;
      setEndpointMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEndpointMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [endpointMenuOpen]);

  const selectedEndpoint = useMemo(
    () => API_DOC_ENDPOINTS.find((endpoint) => endpointKey(endpoint) === selectedKey) || defaultEndpoint,
    [defaultEndpoint, selectedKey]
  );

  const previewURL = useMemo(
    () => buildRequestURL(apiBase, requestPath, queryString, browserBaseURL, defaultRequest.path) ?? new URL(defaultRequest.path, browserBaseURL),
    [apiBase, browserBaseURL, defaultRequest.path, queryString, requestPath]
  );

  const preview = requestPreview(selectedEndpoint, previewURL, apiKey, requestBody);

  const codeGenRequest = useMemo(() => {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8'
    };
    if (selectedEndpoint.auth === 'apiKey') {
      headers['X-API-Key'] = apiKey.trim() || 'YOUR_API_KEY';
    }
    if (requestBody.trim() && selectedEndpoint.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    return {
      method: selectedEndpoint.method,
      url: previewURL.href,
      headers,
      body: requestBody.trim() || undefined
    };
  }, [selectedEndpoint, apiKey, previewURL, requestBody]);

  const clearResult = useCallback(() => {
    setResult(null);
    setCallError('');
    setDuration(0);
    setResponseHeaders({});
  }, []);

  function applyEndpoint(endpoint: DocEndpoint) {
    const next = explorerDefaults(endpoint);
    setSelectedKey(endpointKey(endpoint));
    setRequestPath(next.path);
    setQueryString(next.query);
    setRequestBody(next.body);
    setApiKey('');
    setDangerConfirmed(false);
    clearResult();
  }

  function chooseEndpoint(endpoint: DocEndpoint) {
    applyEndpoint(endpoint);
    setEndpointMenuOpen(false);
  }

  function restoreHistoryEntry(id: string) {
    const entry = restoreEntry(id);
    if (!entry) return;
    const endpoint = API_DOC_ENDPOINTS.find((item) => endpointKey(item) === entry.endpointKey);
    if (endpoint) {
      setSelectedKey(entry.endpointKey);
    }
    setApiBase(entry.apiBase);
    setRequestPath(entry.requestPath);
    setQueryString(entry.queryString);
    setRequestBody(entry.requestBody);
    if (entry.apiKey) setApiKey(entry.apiKey);
    setDangerConfirmed(false);
    clearResult();
    setShowHistory(false);
  }

  function handleSendClick() {
    if (selectedEndpoint.auth === 'apiKey' && !apiKey.trim()) {
      setCallError(text.apiDocs.keyRequired);
      return;
    }
    if (selectedEndpoint.dangerous && !dangerConfirmed) {
      setConfirmModalOpen(true);
      return;
    }
    callEndpoint();
  }

  async function callEndpoint() {
    clearResult();

    const url = buildRequestURL(apiBase, requestPath, queryString, browserBaseURL, defaultRequest.path);
    if (!url) {
      setCallError(text.apiDocs.invalidURL);
      return;
    }

    const headers = new Headers({ Accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8' });
    let body: string | undefined;
    if (selectedEndpoint.auth === 'apiKey') {
      headers.set('X-API-Key', apiKey.trim());
    }
    if (requestBody.trim() && selectedEndpoint.method !== 'GET') {
      try {
        JSON.parse(requestBody);
      } catch {
        setCallError(text.apiDocs.invalidJSON);
        return;
      }
      headers.set('Content-Type', 'application/json');
      body = requestBody;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setIsCalling(true);
    const startTime = performance.now();

    try {
      const response = await fetch(url.href, {
        method: selectedEndpoint.method,
        headers,
        body,
        credentials: 'omit',
        signal: controller.signal
      });
      const raw = await response.text();
      const elapsed = Math.round(performance.now() - startTime);

      const respHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });

      setDuration(elapsed);
      setResponseHeaders(respHeaders);
      setResult({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: prettyBody(raw),
        url: url.href,
        method: selectedEndpoint.method
      });

      addEntry({
        endpointKey: selectedKey,
        apiBase,
        requestPath,
        queryString,
        requestBody,
        apiKey: apiKey.trim(),
        status: response.status,
        statusText: response.statusText,
        responsePreview: raw.slice(0, 500),
        duration: elapsed
      });
    } catch (error) {
      setCallError(error instanceof Error && error.name === 'AbortError' ? text.apiDocs.timeout : String(error));
    } finally {
      window.clearTimeout(timeout);
      setIsCalling(false);
    }
  }

  const prompt = apiSkillPrompt(skillURL, markdownURL);

  return (
    <div className="api-docs-page">
      <ApiDocsHero markdownURL={markdownURL} skillURL={skillURL} prompt={prompt} markdown={markdown} />

      <section className="api-docs-workspace">
        <div className="panel-header api-docs-workspace-header">
          <div>
            <h2>{text.apiDocs.workspaceTitle}<InfoTip text={text.apiDocs.workspaceDesc} /></h2>
          </div>
          <div className="api-docs-explorer-badges">
            <span className={`method-badge method-${selectedEndpoint.method.toLowerCase()}`}>{selectedEndpoint.method}</span>
            <button
              className={`btn-icon ${showHistory ? 'active' : ''}`}
              title={text.apiDocs.requestHistory}
              onClick={() => setShowHistory((value) => !value)}
            >
              <History size={16} />
            </button>
          </div>
        </div>

        <div className="api-docs-workspace-grid">
          <div className="api-docs-config-panel" style={{ maxHeight: 'calc(100vh - 14rem)', overflowY: 'auto' }}>
            <label className="api-docs-field" htmlFor="explorer-api-base">
              <span>{text.apiDocs.apiBase}</span>
              <input id="explorer-api-base" className="input" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
            </label>
            <div className="api-docs-field">
              <span>{text.apiDocs.apiKey}</span>
              <ApiKeySelector value={apiKey} onChange={setApiKey} placeholder={text.apiDocs.apiKeyPlaceholder} />
            </div>
            <div className="api-docs-field api-docs-field-wide">
              <div className="api-docs-field-head">
                <span>{text.apiDocs.endpointsTitle}</span>
                <small>{language === 'zh-CN' ? `${API_DOC_ENDPOINTS.length} 个接口` : `${API_DOC_ENDPOINTS.length} endpoints`}</small>
              </div>
              <div className="api-docs-endpoint-select" ref={endpointSelectRef}>
                <button
                  type="button"
                  className="api-docs-endpoint-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={endpointMenuOpen}
                  onClick={() => setEndpointMenuOpen((value) => !value)}
                >
                  <span className={`method-badge method-${selectedEndpoint.method.toLowerCase()}`}>{selectedEndpoint.method}</span>
                  <span className="api-docs-endpoint-trigger-title">{endpointTitle(selectedEndpoint, language)}</span>
                  <ChevronDown size={16} className={endpointMenuOpen ? 'open' : ''} />
                </button>
                <AnimatePresence>
                  {endpointMenuOpen && (
                    <motion.div
                      className="api-docs-endpoint-menu"
                      role="listbox"
                      aria-label={text.apiDocs.endpointsTitle}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      {API_DOC_ENDPOINTS.map((endpoint) => {
                        const active = selectedKey === endpointKey(endpoint);
                        return (
                          <button
                            key={`${endpoint.method}-${endpoint.path}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={`api-docs-endpoint-option ${active ? 'active' : ''}`}
                            onClick={() => chooseEndpoint(endpoint)}
                          >
                            <span className={`method-badge method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                            <span>{endpointTitle(endpoint, language)}</span>
                            {active && <Check size={15} />}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="api-docs-endpoint-summary">
                <span className={`method-badge method-${selectedEndpoint.method.toLowerCase()}`}>{selectedEndpoint.method}</span>
                <p>{endpointDesc(selectedEndpoint, language)}</p>
              </div>
            </div>
            <label className="api-docs-field" htmlFor="explorer-path">
              <span>{text.apiDocs.path}</span>
              <input id="explorer-path" className="input" value={requestPath} onChange={(event) => setRequestPath(event.target.value)} />
            </label>
            <div className="api-docs-field api-docs-field-wide">
              <span>{text.apiDocs.queryString}</span>
              <ParamBuilder mode="query" value={queryString} onChange={setQueryString} disabled={isCalling} />
            </div>
            <div className="api-docs-field api-docs-field-wide">
              <span>{text.apiDocs.jsonBody}</span>
              <ParamBuilder mode="json" value={requestBody} onChange={setRequestBody} disabled={isCalling || selectedEndpoint.method === 'GET'} />
            </div>

            {selectedEndpoint.dangerous && (
              <label className="api-docs-danger" htmlFor="explorer-danger-confirm">
                <input id="explorer-danger-confirm" type="checkbox" checked={dangerConfirmed} onChange={(event) => setDangerConfirmed(event.target.checked)} />
                <AlertTriangle size={16} />
                <span>{text.apiDocs.confirmDanger}</span>
              </label>
            )}

            <div className="api-docs-final-url" style={{ position: 'sticky', bottom: 0, zIndex: 5 }}>
              <Globe size={14} />
              <code>{previewURL.href}</code>
              <button className="btn-icon" onClick={(event) => copy(previewURL.href, { event })} title={text.common.copy}>
                <Copy size={13} />
              </button>
            </div>
          </div>

          <div className="api-docs-preview-panel">
            <div className="api-docs-call-layout">
              <div className="api-docs-call-panel">
                <div className="api-docs-call-head">
                  <span><Terminal size={15} /> {text.apiDocs.requestPreview}</span>
                  <div className="api-docs-call-actions">
                    <button
                      className={`btn-icon ${showCodeGen ? 'active' : ''}`}
                      onClick={() => setShowCodeGen((value) => !value)}
                      title="Generate code"
                    >
                      <Code size={15} />
                    </button>
                    <button className="btn-secondary" onClick={(event) => copy(preview, { event })}>
                      <Copy size={15} />
                      {text.common.copy}
                    </button>
                  </div>
                </div>
                {showCodeGen ? (
                  <div className="api-docs-codegen">
                    <div className="api-docs-codegen-tabs">
                      {CODE_GEN_LANGUAGES.map((lang) => (
                        <button
                          key={lang}
                          className={codeGenLang === lang ? 'active' : ''}
                          onClick={() => setCodeGenLang(lang)}
                        >
                          {codeGenLabel(lang)}
                        </button>
                      ))}
                    </div>
                    <pre aria-label="Generated code"><code>{generateCode(codeGenRequest, codeGenLang)}</code></pre>
                  </div>
                ) : (
                  <pre aria-label="Request preview"><code>{preview}</code></pre>
                )}
              </div>

              <div className="api-docs-call-panel api-docs-response-panel">
                <div className="api-docs-call-head">
                  <span><Send size={15} /> {text.apiDocs.response}</span>
                  <button className="btn-primary" disabled={isCalling} onClick={handleSendClick}>
                    <Play size={15} />
                    {isCalling ? text.apiDocs.sending : text.apiDocs.send}
                  </button>
                </div>
                <ResponsePanel
                  result={result}
                  callError={callError}
                  duration={duration}
                  responseHeaders={responseHeaders}
                  onCopyBody={() => result && copy(result.body)}
                  emptyText={text.apiDocs.noResponse}
                />
              </div>
            </div>

            <div className="api-docs-reference-notes">
              <section className="api-docs-note">
                <h2>{text.apiDocs.authTitle}</h2>
                <p>{text.apiDocs.authDesc}</p>
              </section>
              <section className="api-docs-note">
                <h2>{text.apiDocs.responseTitle}</h2>
                <p>{text.apiDocs.responseDesc}</p>
              </section>
            </div>

            <ApiDocsHistory
              showHistory={showHistory}
              history={history}
              setShowHistory={setShowHistory}
              clearHistory={clearHistory}
              removeEntry={removeEntry}
              restoreHistoryEntry={restoreHistoryEntry}
            />
          </div>
        </div>
      </section>

      <ApiDocsMarkdownPreview markdown={markdown} isError={docs.isError} markdownURL={markdownURL} />

      <ConfirmModal
        open={confirmModalOpen}
        title={text.apiDocs.confirmDangerTitle}
        description={text.apiDocs.confirmDangerDesc || `You are about to send a ${selectedEndpoint.method} request to ${selectedEndpoint.path}. This operation may delete data.`}
        danger
        requireType={selectedEndpoint.path}
        confirmText={text.common.delete}
        cancelText={text.common.cancel}
        onConfirm={() => {
          setConfirmModalOpen(false);
          callEndpoint();
        }}
        onCancel={() => setConfirmModalOpen(false)}
      />
    </div>
  );
}
