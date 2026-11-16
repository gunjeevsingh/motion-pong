// Match state + phase machine: LOBBY → CALIBRATE → SERVE → RALLY → POINT_END → SERVE … → MATCH_END.
import { CFG } from '../config.js';
import { serverFor, matchWinner, isMatchPoint } from './rules.js';

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY', CALIBRATE: 'CALIBRATE', SERVE: 'SERVE', RALLY: 'RALLY', POINT_END: 'POINT_END', MATCH_END: 'MATCH_END',
});

export class GameState {
  constructor() {
    this.phase = PHASE.LOBBY;
    this.phaseStart = performance.now(); // real time (ms)
    this.listeners = [];
    this.resetMatch();
  }

  resetMatch() {
    this.score = { 1: 0, '-1': 0 };
    this.firstServer = 1;
    this.rally = 0;       // hits in the current rally (both sides)
    this.combo = 0;       // player returns in the current rally
    this.fireLevel = 0;
    this.lastPointWinner = 0;
    this.winner = 0;
  }

  onEnter(fn) { this.listeners.push(fn); }

  enter(phase) {
    const prev = this.phase;
    this.phase = phase;
    this.phaseStart = performance.now();
    for (const fn of this.listeners) fn(phase, prev);
  }

  /** Seconds since entering the current phase (real time). */
  get inPhase() { return (performance.now() - this.phaseStart) / 1000; }

  get server() { return serverFor(this.score[1], this.score[-1], CFG.WIN_SCORE, this.firstServer); }
  get matchWinner() { return matchWinner(this.score[1], this.score[-1], CFG.WIN_SCORE); }
  get matchPoint() { return isMatchPoint(this.score[1], this.score[-1], CFG.WIN_SCORE); }

  newRally() {
    this.rally = 0;
    this.combo = 0;
    this.fireLevel = 0;
  }

  /** Award a point; returns the match winner (0 if the match continues). */
  award(side) {
    this.score[side]++;
    this.lastPointWinner = side;
    this.winner = this.matchWinner;
    return this.winner;
  }
}
