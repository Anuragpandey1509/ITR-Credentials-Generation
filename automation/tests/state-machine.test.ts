import { StateMachine, VALID_TRANSITIONS } from '../src/state-machine';
import type { Phase } from '@itr/shared';

describe('StateMachine', () => {
  describe('valid transitions', () => {
    it('starts in IDLE', () => {
      const fsm = new StateMachine('test-job-1');
      expect(fsm.phase).toBe('IDLE');
    });

    it('IDLE → NAVIGATING', () => {
      const fsm = new StateMachine('test-job-1');
      const t = fsm.transition('NAVIGATING');
      expect(fsm.phase).toBe('NAVIGATING');
      expect(t.from).toBe('IDLE');
      expect(t.to).toBe('NAVIGATING');
    });

    it('follows the happy path end-to-end', () => {
      const fsm = new StateMachine('test-job-1');
      const path: Phase[] = ['NAVIGATING', 'CAPTCHA', 'FILLING_DETAILS', 'WAITING_FOR_OTP', 'SUBMITTING_OTP', 'SETTING_PASSWORD', 'DONE'];
      for (const phase of path) {
        fsm.transition(phase);
        expect(fsm.phase).toBe(phase);
      }
    });

    it('allows OTP retry: SUBMITTING_OTP → WAITING_FOR_OTP', () => {
      const fsm = new StateMachine('test-job-1');
      fsm.transition('NAVIGATING');
      fsm.transition('CAPTCHA');
      fsm.transition('FILLING_DETAILS');
      fsm.transition('WAITING_FOR_OTP');
      fsm.transition('SUBMITTING_OTP');
      fsm.transition('WAITING_FOR_OTP'); // wrong OTP retry
      expect(fsm.phase).toBe('WAITING_FOR_OTP');
    });

    it('allows CAPTCHA retry: CAPTCHA → NAVIGATING', () => {
      const fsm = new StateMachine('test-job-1');
      fsm.transition('NAVIGATING');
      fsm.transition('CAPTCHA');
      fsm.transition('NAVIGATING'); // bad captcha, re-navigate
      expect(fsm.phase).toBe('NAVIGATING');
    });

    it('allows FAILED from any active phase', () => {
      const activePhases: Phase[] = ['IDLE', 'NAVIGATING', 'CAPTCHA', 'FILLING_DETAILS', 'WAITING_FOR_OTP', 'SUBMITTING_OTP', 'SETTING_PASSWORD'];
      for (const phase of activePhases) {
        const fsm = new StateMachine('test-job', phase);
        expect(fsm.canTransitionTo('FAILED')).toBe(true);
      }
    });
  });

  describe('invalid transitions', () => {
    it('throws on invalid transition', () => {
      const fsm = new StateMachine('test-job-1');
      expect(() => fsm.transition('DONE')).toThrow('Invalid transition');
    });

    it('throws if transitioning from DONE', () => {
      const fsm = new StateMachine('test-job-1', 'DONE');
      expect(() => fsm.transition('NAVIGATING')).toThrow('Invalid transition');
    });

    it('throws if transitioning from FAILED', () => {
      const fsm = new StateMachine('test-job-1', 'FAILED');
      expect(() => fsm.transition('NAVIGATING')).toThrow('Invalid transition');
    });

    it('cannot skip CAPTCHA phase', () => {
      const fsm = new StateMachine('test-job-1');
      fsm.transition('NAVIGATING');
      expect(() => fsm.transition('FILLING_DETAILS')).toThrow('Invalid transition');
    });
  });

  describe('isTerminal', () => {
    it('returns true for DONE, FAILED, CANCELLED', () => {
      expect(new StateMachine('j', 'DONE').isTerminal()).toBe(true);
      expect(new StateMachine('j', 'FAILED').isTerminal()).toBe(true);
      expect(new StateMachine('j', 'CANCELLED').isTerminal()).toBe(true);
    });

    it('returns false for active phases', () => {
      expect(new StateMachine('j', 'NAVIGATING').isTerminal()).toBe(false);
      expect(new StateMachine('j', 'WAITING_FOR_OTP').isTerminal()).toBe(false);
    });
  });

  describe('canTransitionTo', () => {
    it('returns true for valid next phase', () => {
      const fsm = new StateMachine('j', 'IDLE');
      expect(fsm.canTransitionTo('NAVIGATING')).toBe(true);
    });

    it('returns false for invalid next phase', () => {
      const fsm = new StateMachine('j', 'IDLE');
      expect(fsm.canTransitionTo('DONE')).toBe(false);
    });
  });

  describe('VALID_TRANSITIONS completeness', () => {
    it('has no duplicate from→to pairs', () => {
      const seen = new Set<string>();
      for (const t of VALID_TRANSITIONS) {
        const key = `${t.from}→${t.to}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });
});
