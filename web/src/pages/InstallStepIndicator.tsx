import { Check } from 'lucide-react';
import { useText } from '../locales';

export const STEPS = ['stepAdmin', 'stepDNS', 'stepInstall'] as const;

export function StepIndicator({ current, text }: { current: number; text: ReturnType<typeof useText> }) {
  const steps = [
    { key: STEPS[0], number: 1 },
    { key: STEPS[1], number: 2 },
    { key: STEPS[2], number: 3 },
  ];

  return (
    <ol className="install-steps mx-auto max-w-6xl" aria-label={text.install.stepProgressLabel}>
      {steps.map((step, i) => {
        let cls = 'install-step';
        if (i === current) cls += ' install-step-active';
        else if (i < current) cls += ' install-step-done';
        return (
          <li key={step.key} className={cls} aria-current={i === current ? 'step' : undefined}>
            <span className="install-step-num">{i < current ? <Check size={12} /> : step.number}</span>
            <span className="install-step-label">{(text.install as Record<string, string>)[step.key]}</span>
          </li>
        );
      })}
    </ol>
  );
}
