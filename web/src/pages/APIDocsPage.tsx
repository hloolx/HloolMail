import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Bot, BookOpen, Check, Clock, Code, Copy, Download, Globe, History,
  Link2, Play, Send, Terminal, Trash2, X, ChevronDown, ChevronRight
} from 'lucide-react';
import type { InstallStatus } from '../api';
import { api } from '../api';
import { useText } from '../locales';
import { useAppStore } from '../store';
import { useCopyState } from '../hooks/useCopyState';
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
import { downloadMarkdown } from '../lib/download';
import { useRequestHistory } from '../hooks/useRequestHistory';
import { generateCode, codeGenLabel, type CodeGenLang } from '../lib/codegen';
import { ParamBuilder } from '../components/api-explorer/ParamBuilder';
import { ResponsePanel, type ExplorerResult } from '../components/api-explorer/ResponsePanel';
import { ApiKeySelector } from '../components/api-explorer/ApiKeySelector';
import { ConfirmModal } from '../components/api-explorer/ConfirmModal';
import { SseViewer } from '../components/api-explorer/SseViewer';

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
  const [docsCopied, markDocsCopied] = useCopyState();
  const [skillCopied, markSkillCopied] = useCopyState();
  const [promptCopied, markPromptCopied] = useCopyState();

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
  const [sseOpen, setSseOpen] = useState(false);
  const [endpointMenuOpen, setEndpointMenuOpen] = useState(false);
  const endpointSelectRef = useRef<HTMLDivElement>(null);
  const { history, addEntry, removeEntry, restoreEntry, clearHistory } = useRequestHistory();

  useEffect(() => {
    setApiBase((current) => (current === browserBaseURL ? configuredBaseURL : current));
  }, [browserBaseURL, configuredBaseURL]);

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

  const previewURL = useMemo(() => {
    try {
      const url = new URL(normalizePath(requestPath), (apiBase || browserBaseURL).replace(/\/$/, ''));
      const query = queryString.trim().replace(/^\?/, '');
      if (query) {
        new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
      }
      return url;
    } catch {
      return new URL(defaultRequest.path, browserBaseURL);
    }
  }, [apiBase, browserBaseURL, defaultRequest.path, queryString, requestPath]);

  const preview = requestPreview(selectedEndpoint, previewURL, apiKey, requestBody);

  const codeGenRequest = useMemo(() => {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8'
    };
    if (selectedEndpoint.auth === 'apiKey' && apiKey.trim()) {
      headers['X-API-Key'] = apiKey.trim();
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

  function applyEndpoint(endpoint: DocEndpoint) {
    const next = explorerDefaults(endpoint);
    setSelectedKey(endpointKey(endpoint));
    setRequestPath(next.path);
    setQueryString(next.query);
    setRequestBody(next.body);
    setDangerConfirmed(false);
    setResult(null);
    setCallError('');
    setDuration(0);
    setResponseHeaders({});
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
    setResult(null);
    setCallError('');
    setDuration(0);
    setResponseHeaders({});
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
    if (selectedEndpoint.streaming) {
      setSseOpen(true);
      return;
    }
    callEndpoint();
  }

  async function callEndpoint() {
    setCallError('');
    setResult(null);
    setDuration(0);
    setResponseHeaders({});

    let url: URL;
    try {
      url = new URL(normalizePath(requestPath), (apiBase || browserBaseURL).replace(/\/$/, ''));
      const query = queryString.trim().replace(/^\?/, '');
      if (query) {
        new URLSearchParams(query).forEach((value, key) => url.searchParams.set(key, value));
      }
    } catch {
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
      <section className="api-docs-hero">
        <div className="api-docs-hero-copy">
          <span className="home-kicker">
            <BookOpen size={14} />
            {text.page['api-docs']}
          </span>
          <h1>{text.apiDocs.title}</h1>
          <p>{text.apiDocs.desc}</p>
        </div>

        <div className="api-docs-handoff-grid">
          <article className="api-docs-handoff-card api-docs-md-card">
            <div className="api-docs-handoff-icon">
              <BookOpen size={18} />
            </div>
            <div>
              <h2>{text.apiDocs.mdLink}</h2>
              <p>{text.apiDocs.mdLinkHint}</p>
              <code>{markdownURL}</code>
              <div className="api-docs-mini-actions">
                <button className="btn-secondary" onClick={(event) => { copy(markdownURL, { celebrate: true, event, label: text.apiDocs.docsLinkCopied }); markDocsCopied(); }}>
                  {docsCopied ? <Check size={15} /> : <Link2 size={15} />}
                  {docsCopied ? text.common.copied : text.common.copyMdLink}
                </button>
                <button className="btn-primary" onClick={() => downloadMarkdown('hlool-mail-api-docs.md', markdown)}>
                  <Download size={15} />
                  {text.common.exportMd}
                </button>
              </div>
            </div>
          </article>
          <article className="api-docs-handoff-card">
            <div className="api-docs-handoff-icon">
              <Bot size={18} />
            </div>
            <div>
              <h2>{text.apiDocs.skillLink}</h2>
              <p>{text.apiDocs.skillLinkHint}</p>
              <code>{skillURL}</code>
              <div className="api-docs-mini-actions">
                <button className="btn-secondary" onClick={(event) => { copy(skillURL, { celebrate: true, event, label: text.apiDocs.skillLinkCopied }); markSkillCopied(); }}>
                  {skillCopied ? <Check size={15} /> : <Link2 size={15} />}
                  {skillCopied ? text.common.copied : text.apiDocs.copySkillLink}
                </button>
                <button className="btn-secondary" onClick={(event) => { copy(prompt, { celebrate: true, event, label: text.apiDocs.skillPromptCopied }); markPromptCopied(); }}>
                  {promptCopied ? <Check size={15} /> : <Copy size={15} />}
                  {promptCopied ? text.common.copied : text.apiDocs.copySkillPrompt}
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="api-docs-workspace">
        <div className="panel-header api-docs-workspace-header">
          <div>
            <h2>{text.apiDocs.workspaceTitle}</h2>
            <p>{text.apiDocs.workspaceDesc}</p>
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
          <div className="api-docs-config-panel">
            <label className="api-docs-field">
              <span>{text.apiDocs.apiBase}</span>
              <input className="input" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
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
                {endpointMenuOpen && (
                  <div className="api-docs-endpoint-menu" role="listbox" aria-label={text.apiDocs.endpointsTitle}>
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
                  </div>
                )}
              </div>
              <div className="api-docs-endpoint-summary">
                <span className={`method-badge method-${selectedEndpoint.method.toLowerCase()}`}>{selectedEndpoint.method}</span>
                <p>{endpointDesc(selectedEndpoint, language)}</p>
              </div>
            </div>
            <label className="api-docs-field">
              <span>{text.apiDocs.path}</span>
              <input className="input" value={requestPath} onChange={(event) => setRequestPath(event.target.value)} />
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
              <label className="api-docs-danger">
                <input type="checkbox" checked={dangerConfirmed} onChange={(event) => setDangerConfirmed(event.target.checked)} />
                <AlertTriangle size={16} />
                <span>{text.apiDocs.confirmDanger}</span>
              </label>
            )}

            <div className="api-docs-final-url">
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
                    <pre><code>{generateCode(codeGenRequest, codeGenLang)}</code></pre>
                  </div>
                ) : (
                  <pre><code>{preview}</code></pre>
                )}
              </div>

              <div className="api-docs-call-panel api-docs-response-panel">
                <div className="api-docs-call-head">
                  <span><Send size={15} /> {text.apiDocs.response}</span>
                  <button className="btn-primary" disabled={isCalling} onClick={handleSendClick}>
                    <Play size={15} />
                    {selectedEndpoint.streaming ? text.apiDocs.openStream : isCalling ? text.apiDocs.sending : text.apiDocs.send}
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

            {showHistory && (
              <div className="api-docs-history">
                <div className="api-docs-history-head">
                  <span><History size={15} /> {text.apiDocs.requestHistory}</span>
                  <div className="api-docs-history-actions">
                    {history.length > 0 && (
                      <button className="btn-icon" onClick={clearHistory} title="Clear history">
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button className="btn-icon" onClick={() => setShowHistory(false)}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {history.length === 0 ? (
                  <div className="api-docs-history-empty">{text.apiDocs.noHistory}</div>
                ) : (
                  <div className="api-docs-history-list">
                    {history.map((entry) => (
                      <div key={entry.id} className="api-docs-history-item">
                        <button className="api-docs-history-restore" onClick={() => restoreHistoryEntry(entry.id)}>
                          <span className={`api-docs-history-status ${entry.status && entry.status >= 200 && entry.status < 300 ? 'ok' : entry.status ? 'bad' : ''}`}>
                            {entry.status || '-'}
                          </span>
                          <span className="api-docs-history-endpoint">{entry.endpointKey}</span>
                          <span className="api-docs-history-meta">
                            <Clock size={12} />
                            {entry.duration !== undefined ? `${entry.duration}ms` : '-'}
                          </span>
                          <ChevronRight size={14} className="api-docs-history-arrow" />
                        </button>
                        <button className="api-docs-history-delete" onClick={() => removeEntry(entry.id)} title="Remove">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {sseOpen && (
        <div className="api-docs-sse-overlay">
          <div className="api-docs-sse-panel">
            <SseViewer
              url={previewURL.href}
              headers={{ 'X-API-Key': apiKey.trim() }}
              onClose={() => setSseOpen(false)}
            />
          </div>
        </div>
      )}

      <section className="api-docs-preview">
        <div className="panel-header">
          <div>
            <h2>{text.apiDocs.previewTitle}</h2>
            <p>{docs.isError ? `${markdownURL} local fallback` : API_DOCS_MD_PATH}</p>
          </div>
        </div>
        <pre className="api-docs-md-preview"><code>{markdown}</code></pre>
      </section>

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
