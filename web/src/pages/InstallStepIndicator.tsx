import { Check } from 'lucide-react';
import { useText } from '../locales';

export const STEPS = ['stepAdmin', 'stepDNS', 'stepInstall'] as const;

export function StepIndicator({ current, text, onStep }: { current: number; text: ReturnType<typeof useText>; onStep: (step: number) => void }) {
  const steps = [
    { key: STEPS[0], number: 1 },
    { key: STEPS[1], number: 2 },
    { key: STEPS[2], number: 3 },
  ];

  return (
    <div className="install-steps mx-auto max-w-6xl">
      {steps.map((step, i) => {
        let cls = 'install-step';
        if (i === current) cls += ' install-step-active';
        else if (i < current) cls += ' install-step-done';
        return (
          <button key={step.key} type="button" className={cls} onClick={() => onStep(i)}>
            <span className="install-step-num">{i < current ? <Check size={12} /> : step.number}</span>
            <span className="install-step-label">{(text.install as Record<string, string>)[step.key]}</span>
          </button>
        );
      })}
    </div>
  );
}
