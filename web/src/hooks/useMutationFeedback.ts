import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, QueryKey } from '@tanstack/react-query';
import { notifySuccess } from '../lib/feedback';
import { toast } from 'sonner';

export interface MutationFeedbackOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown>
  extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'onSuccess' | 'onError'> {
  successMessage?: string;
  errorMessage?: string;
  invalidateQueries?: QueryKey[];
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void;
  onSuccessFeedback?: (data: TData, variables: TVariables, context: TContext | undefined) => void;
}

/**
 * Enhanced useMutation hook with automatic success/error feedback and query invalidation.
 *
 * @example
 * const deleteMutation = useMutationFeedback({
 *   mutationFn: (id: number) => api(`/api/keys/${id}`, { method: 'DELETE' }),
 *   successMessage: 'API Key deleted successfully',
 *   invalidateQueries: [['api-keys']],
 * });
 */
export function useMutationFeedback<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: MutationFeedbackOptions<TData, TError, TVariables, TContext>
) {
  const queryClient = useQueryClient();
  const {
    successMessage,
    errorMessage,
    invalidateQueries,
    onSuccessFeedback,
    onSuccess: userOnSuccess,
    onError: userOnError,
    ...restOptions
  } = options;

  return useMutation<TData, TError, TVariables, TContext>({
    ...restOptions,
    onSuccess: (data, variables, context) => {
      // Show success toast
      if (successMessage) {
        notifySuccess(successMessage);
      }

      // Invalidate queries
      if (invalidateQueries) {
        invalidateQueries.forEach((queryKey) => {
          queryClient.invalidateQueries({ queryKey });
        });
      }

      // Custom success feedback
      onSuccessFeedback?.(data, variables, context);

      // Call original onSuccess if provided
      userOnSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      // Show error toast
      const message = errorMessage || (error instanceof Error ? error.message : 'Operation failed');
      toast.error(message);

      // Call original onError if provided
      userOnError?.(error, variables, context);
    },
  });
}
