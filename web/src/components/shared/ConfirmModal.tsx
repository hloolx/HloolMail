import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'

type ConfirmModalProps = {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  requireType?: string
  onConfirm: () => void
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
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [inputValue, setInputValue] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const canConfirm = requireType ? inputValue === requireType : true

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
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
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
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'color-mix(in srgb, var(--foreground) 50%, transparent)' }}
            onClick={onCancel}
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
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {/* Close button */}
            <button
              ref={closeButtonRef}
              onClick={onCancel}
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
                className="rounded-lg border border-[var(--border)] bg-[var(--soft)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
              >
                {cancelText}
              </button>
              <button
                ref={confirmButtonRef}
                onClick={onConfirm}
                disabled={!canConfirm}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition-colors ${
                  danger
                    ? 'bg-[var(--bad)] hover:bg-[var(--bad)]/90 disabled:bg-[var(--bad)]/40'
                    : 'bg-[var(--good)] hover:bg-[var(--good)]/90 disabled:bg-[var(--good)]/40'
                } disabled:cursor-not-allowed`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
