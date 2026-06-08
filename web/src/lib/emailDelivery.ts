import type { EmailDeliveryStatus } from '../types';

export function isEmailDeliveryInProgress(status?: EmailDeliveryStatus) {
  return status === 'pending' || status === 'delivering' || status === 'retry';
}

export function isEmailDeliverySucceeded(status?: EmailDeliveryStatus) {
  return status === 'succeeded';
}

export function isEmailDeliveryFailed(status?: EmailDeliveryStatus) {
  return status === 'failed';
}

export function isEmailDeliveryDone(status?: EmailDeliveryStatus) {
  return isEmailDeliverySucceeded(status) || isEmailDeliveryFailed(status);
}

export function formatDeliveryError(template: string, error: string) {
  return template.replace('{error}', error);
}
