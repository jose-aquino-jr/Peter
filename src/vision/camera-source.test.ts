import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import { CameraSource } from "./camera-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CameraSource permission failures", () => {
  it("surfaces a denied camera permission and stops any acquired media", async () => {
    const events = new InMemoryEventBus();
    const statuses: string[] = [];
    events.on("vision.camera-status", ({ status }) => statuses.push(status));
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
      },
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const camera = new CameraSource(events);

    await expect(camera.start(video)).rejects.toThrow("Permission denied");
    expect(statuses).toEqual(["requesting", "idle", "denied"]);
  });
});
