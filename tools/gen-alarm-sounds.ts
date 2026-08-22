/**
 * Render the anchor-watch alarm tones to WAV files for the Android foreground
 * service.
 *
 * Usage: bun tools/gen-alarm-sounds.ts
 * Output: android/app/src/main/res/raw/anchor_alarm_{drag,gps_loss,watch_failure}.wav
 *
 * WHY THESE EXIST
 * The service used to sound the device's *default* alarm ringtone, which on a
 * Samsung is a pleasant steel-drum tune: not our alarm, not alarming, and
 * different on every device. These files give the native alarm the same voice
 * the web build has had all along, identically on every phone.
 *
 * WHAT THEY CONTAIN
 * One beat period each, byte-for-byte what src/cob/CobAlarm.ts synthesizes with
 * Web Audio, from the same constants (src/anchor/anchor-alarm-tones.ts — this
 * script imports them rather than repeating them, so the two cannot drift):
 *
 *   drag           880 Hz then 660 Hz, 400 ms each, in a 1200 ms period
 *                  (400 ms of silence closes it) — the urgent two-tone siren.
 *   gps-loss       520 Hz held for 800 ms in a 2000 ms period — one steady tone
 *                  on a slower beat, so a lost fix never sounds like a dragging
 *                  anchor.
 *   watch-failure  three 150 ms chirps at 660 Hz, 120 ms apart, in a 3000 ms
 *                  period — the "check the watch" meta-alarm: waking, but
 *                  gentler than either emergency above.
 *
 * Because each file is exactly one period long, MediaPlayer.isLooping
 * reproduces the Web Audio cadence with no scheduling of our own.
 *
 * HOW THEY LOOP WITHOUT CLICKING
 * CobAlarm's gain envelope is reproduced exactly (20 ms attack, 50 ms release),
 * and every period ends in silence, so the sample is at zero on both sides of
 * the loop seam.
 *
 * THE WAVEFORM
 * CobAlarm uses an OscillatorNode of type "square", which Web Audio renders
 * band-limited. A naive square sampled at 44.1 kHz would fold its upper
 * harmonics down into audible aliases, so this sums the odd harmonics up to
 * Nyquist instead — the same buzzy character, none of the grit. The summed
 * series overshoots (Gibbs), so each tone is normalized to CobAlarm's peak gain
 * of 0.4 full scale, which leaves ~8 dB of headroom: loud, and never clipped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  ANCHOR_DRAG_ALARM_TONE,
  ANCHOR_GPS_LOSS_ALARM_TONE,
  ANCHOR_WATCH_FAILURE_ALARM_TONE,
} from "../src/anchor/anchor-alarm-tones";
import type { CobAlarmOptions } from "../src/cob/CobAlarm";

const SAMPLE_RATE = 44100;
/** Matches CobAlarm.tone's gain ramps, in seconds. */
const ATTACK_S = 0.02;
const RELEASE_S = 0.05;
/** Highest harmonic kept, as a fraction of Nyquist — leaves anti-alias margin. */
const HARMONIC_CEILING = 0.95;

const OUT_DIR = "android/app/src/main/res/raw";

/** Band-limited square: odd harmonics only, normalized to unit peak. */
function squareSampler(freqHz: number): (t: number) => number {
  const harmonics: number[] = [];
  const limit = (SAMPLE_RATE / 2) * HARMONIC_CEILING;
  for (let k = 1; k * freqHz < limit; k += 2) harmonics.push(k);
  const raw = (t: number) => {
    let sum = 0;
    for (const k of harmonics)
      sum += Math.sin(2 * Math.PI * k * freqHz * t) / k;
    return sum;
  };
  // Measure the series' true peak (Gibbs overshoot) over one cycle.
  let peak = 0;
  const steps = 4096;
  for (let i = 0; i < steps; i++) {
    peak = Math.max(peak, Math.abs(raw(i / steps / freqHz)));
  }
  return (t: number) => raw(t) / peak;
}

/** CobAlarm's per-tone gain envelope, evaluated at t seconds into the tone. */
function envelope(t: number, durationSec: number): number {
  if (t < 0 || t > durationSec) return 0;
  if (t < ATTACK_S) return t / ATTACK_S;
  const releaseAt = durationSec - RELEASE_S;
  if (t < releaseAt) return 1;
  return Math.max(0, (durationSec - t) / RELEASE_S);
}

/** One beat period of the given alarm, as floats in -1..1. */
function renderBeat(tone: Required<CobAlarmOptions>): Float64Array {
  const total = Math.round((SAMPLE_RATE * tone.beatIntervalMs) / 1000);
  const out = new Float64Array(total);
  const toneSec = tone.toneMs / 1000;
  // Tones start every toneMs + toneGapMs — the same stride CobAlarm schedules.
  const strideSec = (tone.toneMs + tone.toneGapMs) / 1000;
  tone.toneHz.forEach((freqHz, index) => {
    const sampler = squareSampler(freqHz);
    const start = Math.round(index * strideSec * SAMPLE_RATE);
    const length = Math.round(toneSec * SAMPLE_RATE);
    for (let i = 0; i < length && start + i < total; i++) {
      const t = i / SAMPLE_RATE;
      out[start + i] += sampler(t) * envelope(t, toneSec) * tone.gain;
    }
  });
  return out;
}

/** 16-bit PCM mono WAV, canonical 44-byte header. */
function encodeWav(samples: Float64Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Parse the file back and prove it is what the service expects. */
function selfCheck(path: string, tone: Required<CobAlarmOptions>): void {
  const buf = readFileSync(path);
  const fail = (msg: string): never => {
    throw new Error(`${path}: ${msg}`);
  };
  if (buf.toString("ascii", 0, 4) !== "RIFF") fail("not RIFF");
  if (buf.toString("ascii", 8, 12) !== "WAVE") fail("not WAVE");
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  if (channels !== 1) fail(`channels=${channels}`);
  if (rate !== SAMPLE_RATE) fail(`rate=${rate}`);
  if (bits !== 16) fail(`bits=${bits}`);
  if (buf.readUInt32LE(4) !== buf.length - 8) fail("RIFF size mismatch");
  if (dataBytes !== buf.length - 44) fail("data size mismatch");

  const frames = dataBytes / 2;
  const durationMs = (frames / rate) * 1000;
  if (Math.abs(durationMs - tone.beatIntervalMs) > 0.5) {
    fail(`duration ${durationMs.toFixed(1)}ms != one beat`);
  }
  // A loop seam is silent only if both ends are.
  if (buf.readInt16LE(44) !== 0 || buf.readInt16LE(buf.length - 2) !== 0) {
    fail("loop seam is not at zero");
  }
  let peak = 0;
  for (let i = 44; i < buf.length; i += 2) {
    peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
  }
  if (peak >= 32767) fail("clipped");

  // Each tone slot really holds its frequency: the fundamental must dominate a
  // nearby non-harmonic decoy in the steady middle of the slot.
  const sampleAt = (frame: number) => buf.readInt16LE(44 + frame * 2) / 32767;
  tone.toneHz.forEach((freqHz, index) => {
    const mid = Math.round(
      ((index * (tone.toneMs + tone.toneGapMs) + tone.toneMs / 2) / 1000) *
        rate,
    );
    // Never wider than the tone itself — short chirps get a shorter probe.
    const window = Math.round(Math.min(0.1, (tone.toneMs / 1000) * 0.6) * rate);
    const from = Math.round(mid - window / 2);
    const power = (probeHz: number) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < window; i++) {
        const phase = (2 * Math.PI * probeHz * i) / rate;
        re += sampleAt(from + i) * Math.cos(phase);
        im += sampleAt(from + i) * Math.sin(phase);
      }
      return Math.hypot(re, im) / window;
    };
    const wanted = power(freqHz);
    const decoy = power(freqHz * 1.3);
    if (wanted < 0.1 || wanted < decoy * 10) {
      fail(`tone ${index}: ${freqHz} Hz not dominant (${wanted} vs ${decoy})`);
    }
  });
  console.log(
    `${path}: ${durationMs.toFixed(0)} ms, ${rate} Hz mono 16-bit, ` +
      `peak ${(peak / 32767).toFixed(2)} FS, ${buf.length} bytes`,
  );
}

for (const [name, tone] of [
  ["anchor_alarm_drag", ANCHOR_DRAG_ALARM_TONE],
  ["anchor_alarm_gps_loss", ANCHOR_GPS_LOSS_ALARM_TONE],
  ["anchor_alarm_watch_failure", ANCHOR_WATCH_FAILURE_ALARM_TONE],
] as const) {
  const path = `${OUT_DIR}/${name}.wav`;
  writeFileSync(path, encodeWav(renderBeat(tone)));
  selfCheck(path, tone);
}
