import { motion, useReducedMotion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import {
  pageTransition,
  pageTransitionVariants,
  reducedMotionTransition,
  reducedPageTransitionVariants
} from '../../lib/motion';

type PageTransitionProps = Omit<HTMLMotionProps<'div'>, 'animate' | 'exit' | 'initial' | 'transition' | 'variants'> & {
  children: ReactNode;
};

export function PageTransition({ children, ...props }: PageTransitionProps) {
  const shouldReduceMotion = Boolean(useReducedMotion());

  return (
    <motion.div
      {...props}
      initial={shouldReduceMotion ? false : 'initial'}
      animate="animate"
      exit="exit"
      variants={shouldReduceMotion ? reducedPageTransitionVariants : pageTransitionVariants}
      transition={reducedMotionTransition(shouldReduceMotion, pageTransition)}
    >
      {children}
    </motion.div>
  );
}
