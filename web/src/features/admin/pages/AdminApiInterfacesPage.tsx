import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useText } from '../../../locales';
import { notifySuccess } from '../../../lib/feedback';
import { queryKeys } from '../../../lib/queryKeys';
import { useDirtyNavigationGuard } from '../../../hooks/useDirtyNavigationGuard';
import type { APIInterfaceSettings } from '../../../types';
import { InfoTip } from '../../../components/shared';
import { AdminPageFrame } from '../components/AdminPageFrame';
import {
  formFingerprint,
  isDirtyFromBaseline,
  queryErrorMessage
} from '../utils/adminFormatting';
import {
  useAPIInterfaceSettingsQuery,
  useSaveAPIInterfaceSettingsMutation
} from '../hooks/useAdminQueries';

type APIInterfaceSettingsForm = {
  yyds_compatibility_enabled: boolean;
};

export function AdminApiInterfacesPage() {
  const text = useText();
  const queryClient = useQueryClient();
  const apiInterfaceSettings = useAPIInterfaceSettingsQuery();
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const [apiInterfaceForm, setAPIInterfaceForm] = useState<APIInterfaceSettingsForm>({
    yyds_compatibility_enabled: false
  });
  const formRef = useRef(apiInterfaceForm);
  const baselineRef = useRef('');

  useEffect(() => {
    formRef.current = apiInterfaceForm;
  }, [apiInterfaceForm]);

  useEffect(() => {
    const settings = apiInterfaceSettings.data;
    if (!settings) return;
    const nextForm = apiInterfaceFormFromSettings(settings);
    if (isDirtyFromBaseline(formRef.current, baselineRef.current)) return;
    baselineRef.current = formFingerprint(nextForm);
    setAPIInterfaceForm(nextForm);
  }, [apiInterfaceSettings.data]);

  const saveSettings = useSaveAPIInterfaceSettingsMutation({
    onSuccess: (settings) => {
      const nextForm = apiInterfaceFormFromSettings(settings);
      baselineRef.current = formFingerprint(nextForm);
      setAPIInterfaceForm(nextForm);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.apiInterfaceSettings });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditLogsRoot });
      notifySuccess(text.admin.apiInterfaces.saved, { origin: saveButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const refreshSettings = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.apiInterfaceSettings });
  };
  const hasSettingsChanges = isDirtyFromBaseline(apiInterfaceForm, baselineRef.current);
  useDirtyNavigationGuard(hasSettingsChanges && !saveSettings.isPending, text.oauth.unsaved_desc);

  return (
    <AdminPageFrame
      title={text.page['admin-api-interfaces']}
      actions={(
        <button className="btn-secondary" onClick={refreshSettings} disabled={apiInterfaceSettings.isFetching} aria-label={text.admin.refresh}>
          <RefreshCw size={16} className={apiInterfaceSettings.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {text.admin.refresh}
        </button>
      )}
    >
      <section className="panel admin-table-panel admin-api-interface-panel" id="admin-api-interfaces">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.admin.apiInterfaces.title}</h2>
            <p>{text.admin.apiInterfaces.desc}</p>
          </div>
          <button
            ref={saveButtonRef}
            className="btn-secondary"
            type="button"
            onClick={() => saveSettings.mutate({ yyds_compatibility_enabled: apiInterfaceForm.yyds_compatibility_enabled })}
            disabled={saveSettings.isPending || apiInterfaceSettings.isError || !hasSettingsChanges}
            title={apiInterfaceSettings.isError ? text.admin.apiInterfaces.settingsError : !hasSettingsChanges ? text.admin.apiInterfaces.saved : undefined}
            aria-label={text.admin.apiInterfaces.save}
            aria-busy={saveSettings.isPending ? 'true' : undefined}
          >
            {saveSettings.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {text.admin.apiInterfaces.save}
          </button>
        </div>
        {apiInterfaceSettings.isError && (
          <div className="admin-risk admin-risk-warning" role="alert">
            <ShieldAlert size={16} />
            <span><small>{queryErrorMessage(apiInterfaceSettings.error, text.admin.apiInterfaces.settingsError)}</small></span>
            <button className="btn-ghost btn-sm" type="button" onClick={() => apiInterfaceSettings.refetch()} disabled={apiInterfaceSettings.isFetching}>
              {text.common.retry}
            </button>
          </div>
        )}
        <div className="admin-api-interface-grid" aria-busy={apiInterfaceSettings.isLoading ? 'true' : undefined}>
          <div className="admin-api-interface-card">
            <div className="admin-api-interface-title">
              <span className={`admin-api-interface-mark ${apiInterfaceForm.yyds_compatibility_enabled ? 'admin-api-interface-mark-on' : ''}`}>
                <KeyRound size={16} aria-hidden="true" />
              </span>
              <span>
                <b>{text.admin.apiInterfaces.yydsTitle}</b>
                <small>{text.admin.apiInterfaces.yydsPath}</small>
              </span>
            </div>
            <div className="toggle-row">
              <span className="toggle-row-label">
                {text.admin.apiInterfaces.yydsEnabled}
                <InfoTip text={text.admin.apiInterfaces.yydsEnabledDesc} />
              </span>
              <button
                type="button"
                className={`toggle-switch ${apiInterfaceForm.yyds_compatibility_enabled ? 'on' : ''}`}
                onClick={() => setAPIInterfaceForm((current) => ({ ...current, yyds_compatibility_enabled: !current.yyds_compatibility_enabled }))}
                role="switch"
                aria-checked={apiInterfaceForm.yyds_compatibility_enabled}
                aria-label={text.admin.apiInterfaces.yydsEnabled}
              >
                <span className="toggle-switch-knob" />
              </button>
            </div>
          </div>
          <div className="admin-api-interface-card">
            <div className="admin-api-interface-meta">
              <span>{text.admin.apiInterfaces.basePathLabel}</span>
              <code>/yyds/v1</code>
            </div>
            <p>{text.admin.apiInterfaces.scopeNote}</p>
          </div>
        </div>
      </section>
    </AdminPageFrame>
  );
}

function apiInterfaceFormFromSettings(settings: APIInterfaceSettings): APIInterfaceSettingsForm {
  return {
    yyds_compatibility_enabled: settings.yyds_compatibility_enabled
  };
}
