import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import {
  brandPresenceTransition,
  reducedMotionExit,
  reducedMotionInitial,
  reducedMotionLoopTransition,
  reducedMotionTransition
} from '../../lib/motion';
import { AppLogo } from './AppLogo';

export function CenteredState({ children }: { children: ReactNode }) {
  const shouldReduceMotion = Boolean(useReducedMotion());

  return (
    <motion.div
      className="brand-loader-overlay"
      initial={reducedMotionInitial(shouldReduceMotion, { opacity: 0 })}
      animate={{ opacity: 1 }}
      exit={reducedMotionExit(shouldReduceMotion, { opacity: 0, scale: 0.98 })}
      transition={reducedMotionTransition(shouldReduceMotion, brandPresenceTransition)}
    >
      <div className="brand-loader-inner">
        <div className="brand-loader-logo-wrap">
          <motion.div
            className="brand-loader-breathe"
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.5, 0.9, 0.5] }}
            transition={reducedMotionLoopTransition(shouldReduceMotion, 2.4)}
          >
            <AppLogo className="brand-loader-logo" />
          </motion.div>
        </div>
        <motion.p
          className="brand-loader-text"
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.4, 0.85, 0.4] }}
          transition={reducedMotionLoopTransition(shouldReduceMotion, 1.8)}
        >
          {children}
        </motion.p>
      </div>
    </motion.div>
  );
}
