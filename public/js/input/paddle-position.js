// Extension hook (§16): where the player's paddle is laterally.
// Simple mode = AutoFollowProvider (paddle tracks the ball). A future webcam provider
// (MediaPipe Hands / colour tracking) implements the same interface and is swapped in via setProvider().

/**
 * @interface PaddlePositionProvider
 * getX(ctx) → x ∈ [-1, 1] (normalised: -1 = left table edge, +1 = right), or null for "no opinion".
 * ctx = { ballX, ballZ, ballVz, halfWidth, phase }
 */

export class AutoFollowProvider {
  constructor() { this.name = 'auto-follow'; }
  getX(ctx) {
    // Follow the ball when it's approaching the player, otherwise drift back to centre.
    if (ctx.ballVz > 0 || ctx.phase === 'SERVE') return Math.max(-1.3, Math.min(1.3, ctx.ballX / ctx.halfWidth));
    return 0;
  }
}

let provider = new AutoFollowProvider();
export const paddlePosition = {
  get provider() { return provider; },
  setProvider(p) { provider = p; },
  getX(ctx) { return provider.getX(ctx); },
};
