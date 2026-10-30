"""Convert UnityPy's inspected JSON report into Peter's runtime animation asset."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path, help="bundle-report.json from inspect_bundle.py")
    parser.add_argument("output", type=Path, help="Peter runtime animation JSON")
    args = parser.parse_args()

    report = json.loads(args.report.read_text(encoding="utf-8"))
    clip = next((item for item in report["clips"] if item["name"] == "SIM"), None)
    if clip is None:
        raise SystemExit("The inspected bundle report does not contain AnimationClip SIM")

    # The runtime duration follows actual key times. Unity's ClipMuscleConstant
    # stopTime is retained as metadata because it contradicts the key timeline.
    key_times = [key["time"] for curve in clip["curves"] for key in curve["keys"]]
    duration = max(key_times, default=0.0) - min(key_times, default=0.0)
    asset = {
        "schemaVersion": 1,
        "gloss": "SIM",
        "source": {
            "format": "UnityFS",
            "bundleSha256": report["sha256"],
            "bundleSizeBytes": report["sizeBytes"],
            "unityEngineVersion": report["header"]["unityEngineVersion"],
            "extractor": "UnityPy " + report["unitypyVersion"],
            "clipName": clip["name"],
            "legacy": clip["legacy"],
            "compressed": clip["compressed"],
            "sampleRate": clip["sampleRate"],
            "muscleClipStartTime": clip["muscleClip"]["startTime"],
            "muscleClipStopTime": clip["muscleClip"]["stopTime"],
            "durationPolicy": "max key time minus min key time; source stopTime is retained but not used because it is inconsistent",
        },
        "durationSeconds": duration,
        "curves": clip["curves"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(asset, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} ({len(asset['curves'])} source curves, duration {duration:.9f}s)")


if __name__ == "__main__":
    main()
