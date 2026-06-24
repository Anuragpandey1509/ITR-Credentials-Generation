import type { Phase } from '@itr/shared';

// ---------------------------------------------------------------------------
// State Machine Definition
//
// Models the "Forgot Password" flow on the Income-Tax e-filing portal:
//   IDLE → NAVIGATING → CAPTCHA → FILLING_DETAILS → WAITING_FOR_OTP
//        → SUBMITTING_OTP → SETTING_PASSWORD → DONE
//        (from any state) → FAILED | CANCELLED
// ---------------------------------------------------------------------------

export interface Transition {
  from: Phase;
  to: Phase;
}

/** Valid transitions — guards against invalid state changes */
const VALID_TRANSITIONS: Transition[] = [
  { from: 'IDLE',            to: 'NAVIGATING'      },
  { from: 'NAVIGATING',      to: 'CAPTCHA'         },
  { from: 'CAPTCHA',         to: 'FILLING_DETAILS' },
  { from: 'FILLING_DETAILS', to: 'WAITING_FOR_OTP' },
  { from: 'WAITING_FOR_OTP', to: 'SUBMITTING_OTP'  },
  { from: 'SUBMITTING_OTP',  to: 'WAITING_FOR_OTP' }, // wrong OTP → retry
  { from: 'SUBMITTING_OTP',  to: 'SETTING_PASSWORD'},
  { from: 'SETTING_PASSWORD',to: 'DONE'            },
  // Terminal — allowed from any non-terminal state
  { from: 'IDLE',            to: 'FAILED'          },
  { from: 'NAVIGATING',      to: 'FAILED'          },
  { from: 'CAPTCHA',         to: 'FAILED'          },
  { from: 'CAPTCHA',         to: 'NAVIGATING'      }, // retry captcha
  { from: 'FILLING_DETAILS', to: 'FAILED'          },
  { from: 'WAITING_FOR_OTP', to: 'FAILED'          },
  { from: 'SUBMITTING_OTP',  to: 'FAILED'          },
  { from: 'SETTING_PASSWORD',to: 'FAILED'          },
  // Cancellation — allowed from any active (non-terminal) phase
  { from: 'IDLE',            to: 'CANCELLED'       },
  { from: 'NAVIGATING',      to: 'CANCELLED'       },
  { from: 'CAPTCHA',         to: 'CANCELLED'       },
  { from: 'FILLING_DETAILS', to: 'CANCELLED'       },
  { from: 'WAITING_FOR_OTP', to: 'CANCELLED'       },
  { from: 'SUBMITTING_OTP',  to: 'CANCELLED'       },
  { from: 'SETTING_PASSWORD',to: 'CANCELLED'       },
];

// ---------------------------------------------------------------------------
// StateMachine class
// ---------------------------------------------------------------------------

export class StateMachine {
  private _phase: Phase;
  private readonly _jobId: string;

  constructor(jobId: string, initialPhase: Phase = 'IDLE') {
    this._phase = initialPhase;
    this._jobId = jobId;
  }

  get phase(): Phase {
    return this._phase;
  }

  get jobId(): string {
    return this._jobId;
  }

  /**
   * Returns the Transition if valid, throws if not.
   */
  transition(to: Phase): Transition {
    const valid = VALID_TRANSITIONS.find(
      (t) => t.from === this._phase && t.to === to
    );

    if (!valid) {
      throw new Error(
        `Invalid transition: ${this._phase} → ${to} for job ${this._jobId}`
      );
    }

    const transition = { from: this._phase, to };
    this._phase = to;
    return transition;
  }

  /**
   * Check without mutating (useful for guards)
   */
  canTransitionTo(to: Phase): boolean {
    return VALID_TRANSITIONS.some((t) => t.from === this._phase && t.to === to);
  }

  isTerminal(): boolean {
    return this._phase === 'DONE' || this._phase === 'FAILED' || this._phase === 'CANCELLED';
  }
}

// ---------------------------------------------------------------------------
// Export transitions list for testing
// ---------------------------------------------------------------------------
export { VALID_TRANSITIONS };
