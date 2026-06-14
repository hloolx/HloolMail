import type { TargetAndTransition, Transition, Variants } from 'framer-motion';

export const productMotionEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const instantTransition: Transition = { duration: 0 };

export const pageTransition: Transition = {
  duration: 0.22,
  ease: productMotionEase
};

export const brandPresenceTransition: Transition = {
  duration: 0.45,
  ease: productMotionEase
};

export const pageTransitionVariants: Variants = {
  initial: {
    opacity: 0
  },
  animate: {
    opacity: 1
  },
  exit: {
    opacity: 0
  }
};

export const reducedPageTransitionVariants: Variants = {
  animate: {
    opacity: 1
  },
  exit: {
    opacity: 0
  }
};

export function reducedMotionInitial(shouldReduceMotion: boolean, target: TargetAndTransition): false | TargetAndTransition {
  return shouldReduceMotion ? false : target;
}

export function reducedMotionExit(
  shouldReduceMotion: boolean,
  target: TargetAndTransition,
  reducedTarget: TargetAndTransition = { opacity: 0 }
): TargetAndTransition {
  return shouldReduceMotion ? { ...reducedTarget, transition: instantTransition } : target;
}

export function reducedMotionTransition(shouldReduceMotion: boolean, transition: Transition): Transition {
  return shouldReduceMotion ? instantTransition : transition;
}

export function reducedMotionLoopTransition(shouldReduceMotion: boolean, duration: number): Transition {
  return reducedMotionTransition(shouldReduceMotion, {
    duration,
    repeat: Infinity,
    ease: 'easeInOut'
  });
}
