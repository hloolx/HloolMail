import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Loader2, X } from 'lucide-react'

type ConfirmModalProps = {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  requireType?: string
  confirmLoading?: boolean
  confirmDisabled?: boolean
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  requireType,
  confirmLoading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [inputValue, setInputValue] = useState('')
  const [promisePending, setPromisePending] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const shouldReduceMotion = useReducedMotion()

  const isConfirmPending = confirmLoading || promisePending
  const canConfirm = (requireType ? inputValue === requireType : true) && !confirmDisabled && !isConfirmPending

  useEffect(() => {
    if (open) {
      setInputValue('')
      // Focus the first focusable element when opened
      setTimeout(() => {
        if (requireType) {
          inputRef.current?.focus()
        } else if (cancelButtonRef.current) {
          cancelButtonRef.current.focus()
        } else {
          confirmButtonRef.current?.focus()
        }
      }, 50)
    }
  }, [open, requireType])

  useEffect(() => {
    if (!open) setPromisePending(false)
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!isConfirmPending) onCancel()
        return
      }

      if (event.key !== 'Tab') return

      const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusableElements || focusableElements.length === 0) return

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isConfirmPending, open, onCancel])

  const handleConfirm = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!canConfirm) return
    const result = onConfirm(event)
    if (!isPromiseLike(result)) return

    setPromisePending(true)
    try {
      await result
    } catch {
      // Callers own error feedback, usually through mutation onError handlers.
    } finally {
      setPromisePending(false)
    }
  }

  return (
    <AnimatePresence initial={!shouldReduceMotion}>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'color-mix(in srgb, var(--foreground) 50%, transparent)' }}
            onClick={() => {
              if (!isConfirmPending) onCancel()
            }}
            aria-hidden="true"
          />

          {/* Modal Panel */}
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-desc"
            className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl"
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
          >
            {/* Close button */}
            <button
              ref={closeButtonRef}
              onClick={onCancel}
              disabled={isConfirmPending}
              className="absolute right-4 top-4 rounded-md p-1 text-[var(--muted)] transition-colors hover:bg-[var(--soft)] hover:text-[var(--foreground)]"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="mb-4 flex items-center gap-3 pr-8">
              {danger && (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--bad)]/10">
                  <AlertTriangle size={20} className="text-[var(--bad)]" />
                </div>
              )}
              <div>
                <h2
                  id="confirm-modal-title"
                  className="text-lg font-semibold text-[var(--foreground)]"
                >
                  {title}
                </h2>
              </div>
            </div>

            {/* Description */}
            <p
              id="confirm-modal-desc"
              className="mb-6 text-sm leading-relaxed text-[var(--muted)]"
            >
              {description}
            </p>

            {/* Require type input */}
            {requireType && (
              <div className="mb-6">
                <label className="mb-2 block text-sm text-[var(--muted)]">
                  Type <span className="font-medium text-[var(--foreground)]">'{requireType}'</span> to confirm
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  disabled={isConfirmPending}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--focus)] focus:ring-1 focus:ring-[var(--focus)]"
                  placeholder={requireType}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                ref={cancelButtonRef}
                onClick={onCancel}
                disabled={isConfirmPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--soft)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
              >
                {cancelText}
              </button>
              <button
                ref={confirmButtonRef}
                onClick={handleConfirm}
                disabled={!canConfirm}
                aria-busy={isConfirmPending ? 'true' : undefined}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors ${
                  danger
                    ? 'bg-[var(--bad)] hover:bg-[var(--bad)]/90 disabled:bg-[var(--bad)]/40'
                    : 'bg-[var(--good)] hover:bg-[var(--good)]/90 disabled:bg-[var(--good)]/40'
                } disabled:cursor-not-allowed`}
              >
                {isConfirmPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function isPromiseLike(value: void | Promise<unknown>): value is Promise<unknown> {
  return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function')
}
