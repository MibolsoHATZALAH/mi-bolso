"use client";
// Alarm sound made with Web Audio (no audio file to download). Phones only allow sound after the
// person touches the page, so callers retry on the first tap.
let ctx: AudioContext | null = null;

export async function sonarAlarma(veces = 3): Promise<boolean> {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return false;
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < veces; i++) {
      for (const [k, f] of [[0, 988], [0.18, 784]] as const) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = f;
        const t = t0 + i * 0.7 + k;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t + 0.17);
      }
    }
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch {}
    return true;
  } catch { return false; }
}
