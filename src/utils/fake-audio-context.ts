/**
 * A stand-in AudioContext for tests: records every tone scheduled on it.
 */

/** Records what a tone scheduled on a fake AudioContext. */
export function fakeAudioContext(currentTime = 0) {
  const started: { freq: number; type: string; at: number; until: number }[] =
    [];
  const ramps: [string, number, number][] = [];
  const ctx = {
    currentTime,
    state: "running",
    destination: {},
    createOscillator: () => {
      const osc = {
        type: "sine",
        frequency: { value: 0 },
        connect: (node: unknown) => node,
        start: (at: number) => {
          started.push({
            freq: osc.frequency.value,
            type: osc.type,
            at,
            until: 0,
          });
        },
        stop: (at: number) => {
          started[started.length - 1].until = at;
        },
      };
      return osc;
    },
    createGain: () => ({
      gain: {
        setValueAtTime: (v: number, t: number) => ramps.push(["set", v, t]),
        linearRampToValueAtTime: (v: number, t: number) =>
          ramps.push(["ramp", v, t]),
      },
      connect: (node: unknown) => node,
    }),
  };
  return { ctx: ctx as unknown as AudioContext, started, ramps };
}
