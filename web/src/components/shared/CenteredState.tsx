import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { AppLogo } from './AppLogo';

export function CenteredState({ children }: { children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="brand-loader-overlay"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="brand-loader-inner">
        <div className="brand-loader-logo-wrap">
          <motion.div
            className="brand-loader-breathe"
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.5, 0.9, 0.5] }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <AppLogo className="brand-loader-logo" />
          </motion.div>
        </div>
        <motion.p
          className="brand-loader-text"
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.4, 0.85, 0.4] }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          {children}
        </motion.p>
      </div>
    </motion.div>
  );
}
