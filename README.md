# Motion Pong 🏓

Neon synthwave table tennis against a cute robot. Your **phone is the paddle**: it streams its motion sensors over Wi-Fi to your laptop, which turns swings into shots and buzzes the phone back on every hit.

- Laptop: `http://localhost:3000` (Chrome). Phone: Chrome on Android (built for the Galaxy S23).
- The paddle follows the ball sideways for you. You control **forehand or backhand, timing, power, aim and loft**.
- No phone handy? The whole game plays on the keyboard.

---

## Setup guide

1. **Install Node 18 or newer** from <https://nodejs.org>. Check it with:
   ```bash
   node -v
   ```
2. **Install dependencies:**
   ```bash
   cd motion-pong
   npm install
   ```
3. **Start the server:**
   ```bash
   npm start
   ```
   The terminal prints a box with the laptop URL and the phone URL(s). On first start it creates a self-signed HTTPS certificate in `certs/`.
   *Port already taken?* (Docker often uses 3000.) Run `npm start -- --port 3100 --https-port 3543`. This works in every shell: macOS, Linux, Windows cmd and PowerShell.
4. **Allow the firewall prompt** for Node on **private** networks.
   - Windows: the Defender popup → tick *Private networks* → *Allow access*.
   - macOS: "Allow incoming connections" → *Allow*.
   - Linux (ufw): `sudo ufw allow 3000,3443/tcp`
5. **On the laptop, open Chrome → <http://localhost:3000>.** Click once (this turns on sound). A QR code and a 4-letter room code appear.
6. **Phone:** put the S23 on the **same Wi-Fi** as the laptop. Guest and hotel networks often block devices from talking to each other ("client isolation"). 5 GHz works best.
7. **Connect.** Try these in order:
   - **Option A (2 taps):** scan the QR code with the phone → *"Your connection isn't private"* → **Advanced** → **Proceed to …** → tap **START**.
   - **Option B (if the phone page says "Not a secure page"):** in the S23's Chrome open
     `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://<laptop-ip>:3000`, set it to **Enabled**, and relaunch Chrome. Then switch the laptop panel's toggle to **HTTP** and scan again. Redo this if the laptop's IP changes.
   - **Option C:** any HTTPS tunnel pointed at port 3000, e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`. Open the printed `https://…` URL + `/phone.html?room=CODE` on the phone. This adds latency.
8. The laptop shows **PHONE CONNECTED!** and calibration starts on its own (a 3-2-1 countdown on the phone). Hold the phone **like a paddle and keep it still** for about 3 seconds. Recalibrate any time with the phone's **CALIBRATE** button or `R` on the laptop.
9. **How to play:**
   - Hold the phone with the **screen toward you**, the **back toward the laptop**, and the **top edge up**. This is calibrated as your **forehand** face.
   - **Forehand / backhand:** for a backhand, turn your wrist over so the **screen faces the table**, just like with a real paddle. The swing ring, the phone and the vibration tell you which one registered.
     - The paddle shows it: it's pink toward you in the forehand stance and turns over to its black side for a backhand, as soon as you turn the phone. The swing paths differ too: the forehand sweeps from your racket side across and up; the backhand winds up in front of your belly and flicks out to your racket side.
     - Forehand is the power wing.
     - Backhand is compact: a little less pace and a slightly tighter PERFECT window, but a bonus when blocking fast balls.
     - Playing the wrong wing on a ball wide to one side gives a weak, shanked shot.
   - Swing like a paddle **right after the ball bounces on your side**. Timing grades: **PERFECT / GOOD / EARLY / LATE**.
   - Swing a bit **left/right** (or twist the face) to aim. **Tilt the top toward you** for a lob, or lean it toward the laptop for a flat, fast shot.
   - A hard swing makes a fast shot. Swing to serve, and swing to rematch.
   - First to 11, win by 2. Serve switches every 2 points (every point from 10–10).
10. **Tuning:** press `X` for the debug panel and live sensor readout. If swings don't register, lower `START_THRESH`. If aim or loft feel reversed, tick `INVERT_AIM` / `INVERT_LOFT`.
    - Forehand and backhand are swapped: tick `SWAP_STROKES`. This happens if you hold the phone with your thumb on the back.
    - Left-handed: set `HANDEDNESS`.
    - Don't want the wrong-wing penalty: untick `WRONG_SIDE_PENALTY`.
    - Changes are saved in the browser. Use *Reset all to defaults* to undo them.
11. **Safety:** use a wrist strap or a very tight grip and a sturdy case, and clear the space around you. Swinging phones fly.

### Keyboard (works everywhere, phone or not)

| Key | Action |
|---|---|
| `Space` | swing (power 0.7). Hold `Shift` for full power |
| `←` `→` (hold while swinging) | aim |
| `↑` `↓` (hold while swinging) | loft (↑ lob, ↓ flat) |
| `R` | recalibrate the phone |
| `1` `2` `3` | difficulty: CHILL / NORMAL / SPICY |
| `X` | debug panel + sensor HUD |
| `M` | mute · `N` synthwave music loop |
| `F` | fullscreen |
| `Esc` | pause |

### Troubleshooting

| Problem | Fix |
|---|---|
| Phone: "This site can't be reached" | Allow Node through the firewall on private networks (step 4). Check both devices are on the **same** Wi-Fi and not a guest/hotel network with client isolation. If the laptop has several IPs, pick the Wi-Fi one in the panel's dropdown. |
| Phone: "Not a secure page" | You opened an `http://` link. Use the `https://` QR (HTTPS toggle), or follow Option B. |
| Phone: "Motion sensors are blocked" | Tap the lock/ⓘ icon in the address bar → Permissions → **Motion sensors → Allow**, then reload. Also check Chrome Settings → Site settings → Motion sensors. |
| Swings don't register | Press `X` and watch `|a|` while you swing. Lower `START_THRESH` until normal swings cross it, and lower `FULL_POWER` if every shot feels weak. Make sure the phone chip says **SENSORS OK · ~60Hz**. |
| Swings feel late | Use 5 GHz Wi-Fi, move closer to the router, and close other apps on the phone. Check the RTT shown bottom-right on the laptop (under ~30 ms is good). Option C tunnels add latency. |
| Aim / loft reversed | Debug panel (`X`) → tick `INVERT_AIM` / `INVERT_LOFT`. |
| Forehand shows as backhand | Tick `SWAP_STROKES`. The phone page shows the live face (FOREHAND / BACKHAND / EDGE-ON) under the room code, so you can check it. |
| Forehand/backhand seems to follow the ball side, not my wrist | The phone has no orientation sensor (the terminal says `orientation: none`), so the game picks the natural wing for where the ball is. |
| Forehand/backhand detection drifts after a while | Press `R` (or the phone's CALIBRATE) while holding the forehand pose. |
| Phone screen sleeps / stream stops | The page holds a Wake Lock, so keep Chrome in the foreground and turn off battery saver. If it drops, it reconnects on its own when you return to the page. |
| Laptop is choppy | Open `http://localhost:3000/?lowfx=1` (no bloom/shadows). Bloom resolution also drops on its own when FPS stays under 45. |
| `EADDRINUSE` on start | Another app is using the port: `npm start -- --port 3100 --https-port 3543`. |
| Certificate problems after changing networks | The cert regenerates on its own when the LAN IP changes. Force it with `npm run cert`. |
| iPhone | **Untested.** It needs Safari over HTTPS plus the motion-permission tap (the page asks when you tap START). The axis signs are flipped for iOS but haven't been verified. |

---

## Testing without hardware

```bash
npm test                                   # shot-solver / rules / swing-detector checks (plain Node)
npm run fake-phone -- ABCD                 # impersonate a phone in room ABCD: 60 Hz noise + a swing every 2.5 s
npm run fake-phone -- ABCD --manual        # Enter = forehand, "b" = backhand, "l"/"r" aim, "s" soft
npm run fake-phone -- ABCD --no-orientation # a phone without an orientation sensor (auto-follow paddle)
npm run fake-phone -- ABCD --host localhost:3100 --every 1.5
```

### Terminal log

The `npm start` terminal shows what's happening live, including:

- page loads (with the device's IP and browser)
- laptop and phone joining and leaving
- the phone's sensor mode and calibration
- every swing (power, aim, loft, peak, grade, ms early/late)
- points, combos and match results
- a phone stream health line every 10 s (Hz, peak |a|, dropouts, RTT)
- a warning if the phone stream stalls

Two flags change how much it prints:

- `npm start -- --verbose` also logs every HTTP request and each haptic/status message sent to the phone.
- `npm start -- --quiet` shows errors only.

---

## How it works

```
phone.html ──WS frames (60 Hz: linear accel a, gravity g, gyro w)──▶ server.js (room relay) ──▶ index.html
           ◀── haptic / status / calibrate ─────────────────────────                           swing detector → game → Three.js
```

- `server.js`: Express static + WebSocket room relay on **HTTP :3000** (laptop) and **HTTPS :3443** (phone; sensors need a secure context). `/api/info` returns the LAN IPs and `/api/qr` renders the QR SVG.
- `public/js/input/swing-detector.js`: runs on the laptop so it's live-tunable.
  - It triggers on `|a| > START_THRESH` and emits just after the peak.
  - It computes power (peak), aim (lateral accel + yaw rate) and loft (pre-swing gravity tilt vs. the calibrated pose).
  - It classifies the **stroke**. The phone sends `h`, the screen's heading relative to the calibration pose, from `RelativeOrientationSensor` (or `deviceorientation`). The pose just before the swing gives the stroke: |h| ≤ 70° is forehand, ≥ 110° is backhand. Edge-on, the swing's direction across your body decides, using `lat`, the room-frame lateral accel.
  - On a backhand, aim and loft are mirrored because the phone has turned round.
- `public/js/game/`: fixed-step 120 Hz physics, rules, the shared shot solver (aims at a point on the opponent's half and guarantees net clearance) and the robot AI.
- `public/js/gfx/`: arena (sky, striped sun, scrolling grid, crowd), table/net, ball + trail, paddles + ribbon trails, robot, pooled FX, HUD, bloom/chromatic post.
- `public/js/config.js`: every tunable, with overrides persisted to `localStorage`.

### Extension hook: webcam paddle position
`public/js/input/paddle-position.js` defines the `PaddlePositionProvider` interface (`getX(ctx) → x ∈ [-1, 1]`). The default `AutoFollowProvider` tracks the ball. A future MediaPipe/colour-tracking provider can be swapped in with `paddlePosition.setProvider(myProvider)`.
