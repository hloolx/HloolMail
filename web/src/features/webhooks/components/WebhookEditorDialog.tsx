import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Webhook, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WebhookEndpointDTO, WebhookFormErrors, WebhookFormState, WebhookScope } from '../types';
import { formFromEndpoint, useSaveWebhookMutation, validateWebhookForm } from '../queries';
import { useText } from '../../../locales';
import { DialogShell, IconButton } from '../../../components/shared';
import { Button, Input, Switch } from '../../../components/ui';
import { cn } from '../../../lib/utils';

type WebhookEditorDialogProps = {
  endpoint?: WebhookEndpointDTO;
  onClose: () => void;
  onSaved: (endpoint: WebhookEndpointDTO) => void;
};

const scopeOptions: WebhookScope[] = ['all', 'domain', 'mailbox'];

export function WebhookEditorDialog({ endpoint, onClose, onSaved }: WebhookEditorDialogProps) {
  const text = useText();
  const [form, setForm] = useState<WebhookFormState>(() => formFromEndpoint(endpoint));
  const [submitted, setSubmitted] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<keyof WebhookFormErrors, boolean>>>({});
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const eventSwitchRef = useRef<HTMLButtonElement | null>(null);
  const domainIdInputRef = useRef<HTMLInputElement | null>(null);
  const mailboxIdInputRef = useRef<HTMLInputElement | null>(null);
  const isEdit = Boolean(endpoint);
  const validationMessages = useMemo(
    () => ({
      nameRequired: text.webhooks.nameRequired,
      urlRequired: text.webhooks.urlRequired,
      urlInvalid: text.webhooks.urlInvalid,
      urlHttps: text.webhooks.urlHttps,
      eventRequired: text.webhooks.eventRequired,
      domainIdRequired: text.webhooks.domainIdRequired,
      mailboxIdRequired: text.webhooks.mailboxIdRequired
    }),
    [text]
  );
  const validationErrors = validateWebhookForm(form, validationMessages);
  const visibleErrors = visibleWebhookErrors(validationErrors, touchedFields, submitted);
  const canSave = Object.keys(validationErrors).length === 0;
  const save = useSaveWebhookMutation(endpoint, {
    onSuccess: (data) => {
      toast.success(isEdit ? text.webhooks.saved : text.webhooks.created);
      onSaved(data);
    },
    onError: (error) => toast.error(error.message)
  });

  useEffect(() => {
    setForm(formFromEndpoint(endpoint));
    setSubmitted(false);
    setTouchedFields({});
  }, [endpoint]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!canSave) {
      focusFirstInvalidField(validationErrors, {
        name: nameInputRef,
        url: urlInputRef,
        events: eventSwitchRef,
        domainId: domainIdInputRef,
        mailboxId: mailboxIdInputRef
      });
      return;
    }

    save.mutate(form);
  };
  const touchField = (field: keyof WebhookFormErrors) => setTouchedFields((current) => ({ ...current, [field]: true }));

  return (
    <DialogShell
      as="form"
      className="modal-panel automation-dialog"
      titleId="webhook-editor-title"
      descriptionId="webhook-editor-desc"
      onClose={onClose}
      onSubmit={submit}
      initialFocusRef={nameInputRef}
    >
      <div className="modal-header">
        <div>
          <h2 id="webhook-editor-title">{isEdit ? text.webhooks.editTitle : text.webhooks.createTitle}</h2>
          <p id="webhook-editor-desc">{text.webhooks.dialogDesc}</p>
        </div>
        <IconButton title={text.common.close} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="automation-form">
        <label className="api-key-field">
          <span>{text.webhooks.name}</span>
          <Input
            ref={nameInputRef}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            onBlur={() => touchField('name')}
            invalid={Boolean(visibleErrors.name)}
            aria-describedby={visibleErrors.name ? 'webhook-name-error' : undefined}
          />
          {visibleErrors.name && (
            <span id="webhook-name-error" className="field-error">
              {visibleErrors.name}
            </span>
          )}
        </label>
        <label className="api-key-field">
          <span>{text.webhooks.url}</span>
          <Input
            ref={urlInputRef}
            type="text"
            inputMode="url"
            value={form.url}
            placeholder={text.webhooks.urlPlaceholder}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            onBlur={() => touchField('url')}
            invalid={Boolean(visibleErrors.url)}
            aria-describedby={visibleErrors.url ? 'webhook-url-error' : undefined}
          />
          {visibleErrors.url && (
            <span id="webhook-url-error" className="field-error">
              {visibleErrors.url}
            </span>
          )}
        </label>
        <div className="automation-event-field">
          <div className="check-row automation-check-row">
            <Switch
              ref={eventSwitchRef}
              size="sm"
              checked={form.messageReceived}
              onCheckedChange={(messageReceived) => {
                setForm({ ...form, messageReceived });
                touchField('events');
              }}
              aria-labelledby="webhook-event-message-received-label"
              aria-describedby={visibleErrors.events ? 'webhook-events-error' : undefined}
              aria-invalid={Boolean(visibleErrors.events)}
            />
            <span
              id="webhook-event-message-received-label"
              className="check-row-copy"
            >
              {text.webhooks.eventMessageReceived}
            </span>
          </div>
          {visibleErrors.events && (
            <span id="webhook-events-error" className="field-error">
              {visibleErrors.events}
            </span>
          )}
        </div>
        <div className="api-key-field">
          <span>{text.webhooks.scope}</span>
          <div className="segmented-control" role="group" aria-label={text.webhooks.scope}>
            {scopeOptions.map((scope) => (
              <button
                type="button"
                key={scope}
                className={cn('segment-choice', form.scope === scope && 'segment-choice-active')}
                aria-pressed={form.scope === scope}
                onClick={() => {
                  setForm({ ...form, scope });
                  if (scope === 'domain') touchField('domainId');
                  if (scope === 'mailbox') touchField('mailboxId');
                }}
              >
                {scope === 'all' ? text.webhooks.scopeAll : scope === 'domain' ? text.webhooks.scopeDomain : text.webhooks.scopeMailbox}
              </button>
            ))}
          </div>
        </div>
        {form.scope === 'domain' && (
          <label className="api-key-field">
            <span>{text.webhooks.domainId}</span>
            <Input
              ref={domainIdInputRef}
              inputMode="numeric"
              value={form.domainId}
              onChange={(event) => setForm({ ...form, domainId: event.target.value })}
              onBlur={() => touchField('domainId')}
              invalid={Boolean(visibleErrors.domainId)}
              aria-describedby={visibleErrors.domainId ? 'webhook-domain-id-error' : undefined}
            />
            {visibleErrors.domainId && (
              <span id="webhook-domain-id-error" className="field-error">
                {visibleErrors.domainId}
              </span>
            )}
          </label>
        )}
        {form.scope === 'mailbox' && (
          <label className="api-key-field">
            <span>{text.webhooks.mailboxId}</span>
            <Input
              ref={mailboxIdInputRef}
              inputMode="numeric"
              value={form.mailboxId}
              onChange={(event) => setForm({ ...form, mailboxId: event.target.value })}
              onBlur={() => touchField('mailboxId')}
              invalid={Boolean(visibleErrors.mailboxId)}
              aria-describedby={visibleErrors.mailboxId ? 'webhook-mailbox-id-error' : undefined}
            />
            {visibleErrors.mailboxId && (
              <span id="webhook-mailbox-id-error" className="field-error">
                {visibleErrors.mailboxId}
              </span>
            )}
          </label>
        )}
        <div className="check-row automation-check-row">
          <Switch
            size="sm"
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm({ ...form, enabled })}
            aria-labelledby="webhook-enabled-label"
          />
          <span
            id="webhook-enabled-label"
            className="check-row-copy"
          >
            {text.webhooks.enabled}
          </span>
        </div>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="secondary" onClick={onClose}>{text.common.cancel}</Button>
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          leadingIcon={<Webhook size={16} />}
        >
          {isEdit ? text.webhooks.save : text.common.create}
        </Button>
      </div>
    </DialogShell>
  );
}

function focusFirstInvalidField(
  errors: WebhookFormErrors,
  refs: Record<keyof WebhookFormErrors, RefObject<HTMLElement | null>>
) {
  const firstInvalidKey = (['name', 'url', 'events', 'domainId', 'mailboxId'] as (keyof WebhookFormErrors)[]).find(
    (key) => errors[key]
  );
  if (!firstInvalidKey) return;
  refs[firstInvalidKey].current?.focus();
}

function visibleWebhookErrors(
  errors: WebhookFormErrors,
  touchedFields: Partial<Record<keyof WebhookFormErrors, boolean>>,
  submitted: boolean
): WebhookFormErrors {
  if (submitted) return errors;

  return (Object.keys(errors) as (keyof WebhookFormErrors)[]).reduce<WebhookFormErrors>((visible, key) => {
    if (touchedFields[key]) visible[key] = errors[key];
    return visible;
  }, {});
}
