// Table tennis point rules (simplified arcade, §8.5). Sides: +1 = player, -1 = robot.
export class Rules {
  constructor() { this.reset(); }

  reset() {
    this.lastHitter = 0;
    this.bounces = { 1: 0, '-1': 0 };
  }

  /** @returns {null} */
  onHit(side) {
    this.lastHitter = side;
    this.bounces[1] = 0;
    this.bounces[-1] = 0;
    return null;
  }

  /**
   * @returns {null | {winner:number, reason:string}}
   */
  onBounce(side) {
    const h = this.lastHitter;
    if (!h) return null;
    const opp = -h;
    if (side === h) {
      // Own side: fault, unless it already bounced on the opponent's side (then the receiver failed to return).
      if (this.bounces[opp] > 0) return { winner: h, reason: 'double' };
      return { winner: opp, reason: 'own-side' };
    }
    this.bounces[side]++;
    if (this.bounces[side] >= 2) return { winner: h, reason: 'double' };
    return null;
  }

  /** Net, floor, or out of bounds. */
  onDead(kind) {
    const h = this.lastHitter;
    if (!h) return null;
    if (this.bounces[-h] > 0) return { winner: h, reason: kind === 'net' ? 'net' : 'missed' };
    return { winner: -h, reason: kind };
  }
}

/** Who serves given the score: alternates every 2 points, every point from 10–10 (deuce). */
export function serverFor(scoreP, scoreR, winScore = 11, firstServer = 1) {
  const total = scoreP + scoreR;
  const deuce = winScore - 1;
  let block;
  if (scoreP >= deuce && scoreR >= deuce) block = Math.floor((deuce * 2) / 2) + (total - deuce * 2);
  else block = Math.floor(total / 2);
  return block % 2 === 0 ? firstServer : -firstServer;
}

export function matchWinner(scoreP, scoreR, winScore = 11) {
  if (scoreP >= winScore && scoreP - scoreR >= 2) return 1;
  if (scoreR >= winScore && scoreR - scoreP >= 2) return -1;
  return 0;
}

export function isMatchPoint(scoreP, scoreR, winScore = 11) {
  return matchWinner(scoreP + 1, scoreR, winScore) === 1 || matchWinner(scoreP, scoreR + 1, winScore) === -1;
}
