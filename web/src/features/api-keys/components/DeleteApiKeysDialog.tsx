import { ConfirmModal } from '../../../components/shared';
import { useText } from '../../../locales';
import type { APIKey } from '../types';

type DeleteApiKeysDialogProps = {
  targets: APIKey[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function DeleteApiKeysDialog({ targets, onCancel, onConfirm }: DeleteApiKeysDialogProps) {
  const text = useText();
  const deleteConfirmText = targets.length > 1
    ? text.apiKeys.deleteSelectedConfirm.replace('{count}', String(targets.length))
    : text.apiKeys.deleteConfirm;
  const deleteSummary = targets.length > 1
    ? text.apiKeys.deleteSelectedSummary.replace('{count}', String(targets.length))
    : targets[0]?.name;

  return (
    <ConfirmModal
      open={targets.length > 0}
      title={targets.length > 1 ? text.apiKeys.deleteSelectedTitle : text.apiKeys.deleteKey}
      description={`${deleteConfirmText}\n\n${deleteSummary}`}
      danger
      confirmText={text.common.delete}
      cancelText={text.common.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
