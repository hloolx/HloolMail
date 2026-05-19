import { toast } from 'sonner';
import { dissolveContainer, dissolveElement } from './dissolve';
import { launchSuccessBurst } from './confetti';
import type { DissolveOptions } from './dissolve';
import type { SuccessBurstOptions } from './confetti';

type SuccessFeedbackOptions = SuccessBurstOptions & {
  toast?: boolean;
  burst?: boolean;
};

export function notifySuccess(message: string, options: SuccessFeedbackOptions = {}) {
  const { toast: showToast = true, burst = true, ...burstOptions } = options;
  if (showToast) toast.success(message);
  if (burst) launchSuccessBurst({ label: message, ...burstOptions });
}

export async function runDeleteEffect(target: HTMLElement | null | undefined, options?: DissolveOptions) {
  if (!target || !target.isConnected) return;
  try {
    await dissolveElement(target, { duration: 400, blockSize: 4, direction: 'out', ...options });
  } catch {
    target.style.visibility = 'hidden';
  }
}

export async function runDeleteContainerEffect(target: HTMLElement | null | undefined, options?: DissolveOptions) {
  if (!target || !target.isConnected) return;
  try {
    await dissolveContainer(target, { duration: 500, blockSize: 5, ...options });
  } catch {
    target.style.visibility = 'hidden';
  }
}
