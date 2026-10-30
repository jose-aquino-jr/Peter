import { describe, expect, it } from "vitest";
import { encodeWav, floatToPcm16 } from "./local-speech-transcription-provider";

describe("local speech audio encoding", () => {
  it("converts normalized float samples to clipped PCM16", () => {
    expect([...floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1, 2]))])
      .toEqual([-32768, -16384, 0, 16383, 32767, 32767]);
  });

  it("writes a mono 16-bit PCM WAV with the requested sample rate", () => {
    const wav = encodeWav(new Int16Array([-1, 1]), 16_000);
    const view = new DataView(wav);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
  });
});
