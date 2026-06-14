import { useState, useCallback } from 'react';

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface UseConfirmActionReturn {
  isOpen: boolean;
  config: ConfirmConfig | null;
  confirm: (config: ConfirmConfig) => Promise<boolean>;
  close: () => void;
}

/**
 * Hook for managing confirmation dialogs with Promise-based API.
 *
 * @example
 * const confirmAction = useConfirmAction();
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirmAction.confirm({
 *     title: 'Delete API Key',
 *     message: 'Are you sure you want to delete this API key? This action cannot be undone.',
 *     variant: 'danger',
 *   });
 *
 *   if (confirmed) {
 *     await deleteApiKey(id);
 *   }
 * };
 *
 * return (
 *   <>
 *     <button onClick={handleDelete}>Delete</button>
 *     <ConfirmModal
 *       isOpen={confirmAction.isOpen}
 *       config={confirmAction.config}
 *       onClose={confirmAction.close}
 *     />
 *   </>
 * );
 */
export function useConfirmAction(): UseConfirmActionReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<ConfirmConfig | null>(null);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((cfg: ConfirmConfig): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfig({
        ...cfg,
        onConfirm: async () => {
          try {
            await cfg.onConfirm?.();
            resolve(true);
          } catch (error) {
            console.error('Confirm action error:', error);
            resolve(false);
          } finally {
            setIsOpen(false);
            setConfig(null);
            setResolver(null);
          }
        },
        onCancel: () => {
          cfg.onCancel?.();
          resolve(false);
          setIsOpen(false);
          setConfig(null);
          setResolver(null);
        },
      });
      setIsOpen(true);
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback(() => {
    resolver?.(false);
    setIsOpen(false);
    setConfig(null);
    setResolver(null);
  }, [resolver]);

  return {
    isOpen,
    config,
    confirm,
    close,
  };
}
