import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { AppLogo } from './AppLogo';

export function CenteredState({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="brand-loader-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="brand-loader-inner">
        <div className="brand-loader-logo-wrap">
          <motion.div
            className="brand-loader-breathe"
            animate={{ opacity: [0.5, 0.9, 0.5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <AppLogo className="brand-loader-logo" />
          </motion.div>
        </div>
        <motion.p
          className="brand-loader-text"
          animate={{ opacity: [0.4, 0.85, 0.4] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          {children}
        </motion.p>
      </div>
    </motion.div>
  );
}
