import type { MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { currentText } from '../locales';
import { notifySuccess } from './feedback';
import type { SuccessBurstOptions } from './confetti';

export type CopyOptions = SuccessBurstOptions & {
  celebrate?: boolean;
  event?: ReactMouseEvent<Element>;
  toastMessage?: string;
};

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the textarea path below for browsers that block async clipboard.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

export async function copy(value: string, options: CopyOptions = {}) {
  if (!value) return false;
  const burstOptions = options.celebrate
    ? {
        origin: options.origin,
        x: options.event?.clientX ?? options.x,
        y: options.event?.clientY ?? options.y,
        label: options.label
      }
    : null;
  const text = currentText();
  try {
    await writeClipboard(value);
  } catch {
    toast.error(text.common.copyFailed);
    return false;
  }
  notifySuccess(options.toastMessage || text.common.copied, {
    ...burstOptions,
    burst: Boolean(burstOptions)
  });
  return true;
}
