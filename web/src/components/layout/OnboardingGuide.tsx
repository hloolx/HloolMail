import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, CircleHelp, FileText, Globe2, KeyRound, MailPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { User, UserOnboardingStatus } from '../../api';
import { api, patchJSON } from '../../api';
import { useText } from '../../locales';
import type { Page } from '../../store';
import { useAppStore } from '../../store';

type OnboardingStep = {
  id: 'welcome' | 'domain' | 'mailbox' | 'api-key' | 'api-docs';
  page?: Page;
  target?: string;
  title: string;
  body: string;
  action: string;
  icon: LucideIcon;
};

const ACTIVE_TARGET_ATTR = 'data-onboarding-active';

export function OnboardingGuide({ user }: { user: User }) {
  const text = useText();
  const queryClient = useQueryClient();
  const setPage = useAppStore((state) => state.setPage);
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const onboarding = useQuery({
    queryKey: ['user-onboarding', user.id],
    queryFn: () => api<UserOnboardingStatus>('/api/user/onboarding'),
    enabled: user.role === 'user',
    retry: false,
    staleTime: 30_000
  });

  const steps = useMemo(
    () => buildSteps(text, Boolean(onboarding.data?.require_public_domain_for_quota)),
    [onboarding.data?.require_public_domain_for_quota, text]
  );
  const nextStepIndex = useMemo(() => {
    const nextStep = onboarding.data?.next_step;
    const index = steps.findIndex((step) => step.id === nextStep);
    return index >= 0 ? index : Math.min(1, steps.length - 1);
  }, [onboarding.data?.next_step, steps]);
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)];
  const isWelcomeStep = activeStep?.id === 'welcome';
  const isLastStep = activeStep?.id === 'api-docs';
  const canFinish = isLastStep && Boolean(onboarding.data?.can_complete);

  useEffect(() => {
    if (onboarding.data?.required) {
      setVisible(true);
      setStepIndex(0);
    } else {
      setVisible(false);
    }
  }, [onboarding.data?.required, user.id]);

  useEffect(() => {
    if (!visible || !onboarding.data?.required || isWelcomeStep) return;
    setStepIndex(nextStepIndex);
  }, [isWelcomeStep, nextStepIndex, onboarding.data?.required, visible]);

  useEffect(() => {
    if (!visible || !activeStep?.page) return;
    setPage(activeStep.page);
  }, [activeStep?.page, setPage, visible]);

  useEffect(() => {
    document.documentElement.removeAttribute(ACTIVE_TARGET_ATTR);
    if (!visible || !activeStep?.target) return;

    document.documentElement.setAttribute(ACTIVE_TARGET_ATTR, activeStep.target);
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-onboarding-target="${activeStep.target}"]`);
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
      document.documentElement.removeAttribute(ACTIVE_TARGET_ATTR);
    };
  }, [activeStep?.target, visible]);

  const updateOnboarding = useMutation({
    mutationFn: (payload: { completed?: boolean; skipped?: boolean }) => patchJSON<UserOnboardingStatus>('/api/user/onboarding', payload),
    onSuccess: () => {
      setVisible(false);
      document.documentElement.removeAttribute(ACTIVE_TARGET_ATTR);
      queryClient.invalidateQueries({ queryKey: ['user-onboarding', user.id] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => toast.error(error.message)
  });

  if (!visible || !onboarding.data?.required || !activeStep) return null;

  const Icon = activeStep.icon;
  const complete = () => updateOnboarding.mutate({ completed: true });
  const skip = () => updateOnboarding.mutate({ skipped: true });
  const next = () => {
    if (isWelcomeStep) {
      setStepIndex(nextStepIndex);
      return;
    }
    if (canFinish) {
      complete();
      return;
    }
    void onboarding.refetch();
  };
  const primaryLabel = updateOnboarding.isPending || onboarding.isRefetching
    ? text.common.loading
    : isWelcomeStep
      ? activeStep.action
      : canFinish
        ? text.onboarding.finish
        : text.onboarding.checkProgress;

  return (
    <div className="onboarding-guide" aria-live="polite">
      <div className="onboarding-guide-scrim" aria-hidden="true" />
      <section
        className="onboarding-guide-panel"
        role="dialog"
        aria-labelledby="onboarding-guide-title"
        aria-describedby="onboarding-guide-desc"
      >
        <div className="onboarding-guide-head">
          <div className="onboarding-guide-icon">
            <Icon size={18} aria-hidden="true" />
          </div>
          <div>
            <span>{text.onboarding.step.replace('{current}', String(stepIndex + 1)).replace('{total}', String(steps.length))}</span>
            <h2 id="onboarding-guide-title">{activeStep.title}</h2>
          </div>
        </div>
        <p id="onboarding-guide-desc">{activeStep.body}</p>
        <div className="onboarding-guide-dots" aria-hidden="true">
          {steps.map((step, index) => (
            <span key={step.id} className={index === stepIndex ? 'active' : ''} />
          ))}
        </div>
        <div className="onboarding-guide-actions">
          <button className="btn-ghost" type="button" onClick={skip} disabled={updateOnboarding.isPending}>
            {text.onboarding.skip}
          </button>
          <button className="btn-primary" type="button" onClick={next} disabled={updateOnboarding.isPending || onboarding.isRefetching}>
            {primaryLabel}
            {canFinish ? <CheckCircle2 size={15} /> : <ArrowRight size={15} />}
          </button>
        </div>
      </section>
    </div>
  );
}

function buildSteps(text: ReturnType<typeof useText>, requirePublicDomainForQuota: boolean): OnboardingStep[] {
  return [
    {
      id: 'welcome',
      title: requirePublicDomainForQuota ? text.onboarding.welcomeDomainTitle : text.onboarding.welcomeTitle,
      body: requirePublicDomainForQuota ? text.onboarding.welcomeDomainBody : text.onboarding.welcomeBody,
      action: text.onboarding.start,
      icon: CircleHelp
    },
    ...(requirePublicDomainForQuota ? [{
      id: 'domain' as const,
      page: 'domain-management' as const,
      target: 'add-domain',
      title: text.onboarding.domainTitle,
      body: text.onboarding.domainBody,
      action: text.onboarding.nextMailbox,
      icon: Globe2
    }] : []),
    {
      id: 'mailbox',
      page: 'inbox',
      target: 'create-mailbox',
      title: text.onboarding.mailboxTitle,
      body: text.onboarding.mailboxBody,
      action: text.onboarding.nextApiKey,
      icon: MailPlus
    },
    {
      id: 'api-key',
      page: 'api-keys',
      target: 'create-api-key',
      title: text.onboarding.apiKeyTitle,
      body: text.onboarding.apiKeyBody,
      action: text.onboarding.nextDocs,
      icon: KeyRound
    },
    {
      id: 'api-docs',
      page: 'api-docs',
      target: 'api-docs-explorer',
      title: text.onboarding.apiDocsTitle,
      body: text.onboarding.apiDocsBody,
      action: text.onboarding.finish,
      icon: FileText
    }
  ];
}
