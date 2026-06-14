import { describe, expect, it } from 'vitest';

import {
  instantTransition,
  reducedMotionExit,
  reducedMotionInitial,
  reducedMotionLoopTransition,
  reducedMotionTransition
} from './motion';

describe('reducedMotionInitial', () => {
  it('returns false when motion should be reduced', () => {
    expect(reducedMotionInitial(true, { opacity: 0 })).toBe(false);
  });

  it('returns the target unchanged when motion is allowed', () => {
    const target = { opacity: 0 };
    expect(reducedMotionInitial(false, target)).toBe(target);
  });
});

describe('reducedMotionExit', () => {
  it('returns the target unchanged when motion is allowed', () => {
    const target = { y: 8 };
    expect(reducedMotionExit(false, target)).toBe(target);
  });

  it('replaces with the reduced target and instant transition', () => {
    const result = reducedMotionExit(true, { y: 8 }, { opacity: 0 });
    expect(result).toEqual({ opacity: 0, transition: instantTransition });
  });

  it('uses an opacity-only default reduced target when none is provided', () => {
    expect(reducedMotionExit(true, { y: 8 })).toEqual({ opacity: 0, transition: instantTransition });
  });
});

describe('reducedMotionTransition', () => {
  it('returns the original transition when motion is allowed', () => {
    const transition = { duration: 1 };
    expect(reducedMotionTransition(false, transition)).toBe(transition);
  });

  it('collapses to the instant transition when motion should be reduced', () => {
    expect(reducedMotionTransition(true, { duration: 1 })).toBe(instantTransition);
  });
});

describe('reducedMotionLoopTransition', () => {
  it('builds an infinite looping transition when motion is allowed', () => {
    const result = reducedMotionLoopTransition(false, 2);
    expect(result).toMatchObject({ duration: 2, repeat: Infinity, ease: 'easeInOut' });
  });

  it('collapses to the instant transition when motion should be reduced', () => {
    expect(reducedMotionLoopTransition(true, 2)).toBe(instantTransition);
  });
});
