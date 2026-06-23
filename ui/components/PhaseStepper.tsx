import type { Phase } from '@itr/shared';
import { PHASE_STEPPER_ORDER, PHASE_LABELS } from '@itr/shared';
import { Check, X } from '@phosphor-icons/react/dist/ssr';

interface Props {
  currentPhase: Phase;
}

export function PhaseStepper({ currentPhase }: Props) {
  const isFailed    = currentPhase === 'FAILED' || currentPhase === 'CANCELLED';
  const currentIdx  = PHASE_STEPPER_ORDER.indexOf(currentPhase);

  return (
    <div className="stepper">
      {PHASE_STEPPER_ORDER.map((phase, i) => {
        const isDone   = !isFailed && (currentIdx > i || currentPhase === 'DONE');
        const isActive = !isFailed && currentIdx === i;
        const isFail   = isFailed && currentIdx <= i;

        let dotClass = 'step-dot';
        if (isFail && isActive) dotClass += ' failed';
        else if (isDone) dotClass += ' done';
        else if (isActive) dotClass += ' active';

        return (
          <div key={phase} className={`step-item${isDone ? ' done' : ''}${isActive ? ' active' : ''}`}>
            <div className={dotClass}>
              {isDone ? <Check size={12} weight="bold" /> :
               isFail && isActive ? <X size={12} weight="bold" /> :
               i + 1}
            </div>
            <span className={`step-label${isActive ? ' active' : ''}`}>
              {PHASE_LABELS[phase]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
