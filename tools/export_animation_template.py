"""Offline Blender exporter for Peter's Canonical Skeleton v1 templates."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


JOINTS = (
    "head",
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
    "leftHip",
    "rightHip",
    "leftKnee",
    "rightKnee",
    "leftAnkle",
    "rightAnkle",
    "leftHandWrist",
    "rightHandWrist",
    *(f"{side}{finger}{index}" for side in ("left", "right")
      for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky")
      for index in range(1, 5)),
)
POSE_INDEX = {
    "head": 0,
    "leftShoulder": 11,
    "rightShoulder": 12,
    "leftElbow": 13,
    "rightElbow": 14,
    "leftWrist": 15,
    "rightWrist": 16,
    "leftHip": 23,
    "rightHip": 24,
    "leftKnee": 25,
    "rightKnee": 26,
    "leftAnkle": 27,
    "rightAnkle": 28,
}
FINGERS = (("Thumb", 1), ("Index", 5), ("Middle", 9), ("Ring", 13), ("Pinky", 17))
BODY_JOINTS = tuple(POSE_INDEX)


class AnimationSkeletonMapper:
    """Maps explicitly configured source bones to Peter's stable joint names."""

    def __init__(self, bone_map: dict[str, dict[str, str]]) -> None:
        invalid = set(bone_map) - set(JOINTS)
        if invalid:
            raise ValueError(f"Unknown canonical joint(s): {', '.join(sorted(invalid))}")
        for joint, entry in bone_map.items():
            if not entry.get("bone") or entry.get("point") not in ("head", "tail"):
                raise ValueError(f"Invalid mapping for {joint}; use bone and point=head|tail")
        self.bone_map = bone_map

    def map(self, samples: dict[str, dict[str, tuple[float, float, float]]],
            timestamp: float) -> dict[str, Any]:
        joints: dict[str, dict[str, float]] = {}
        for joint, mapping in self.bone_map.items():
            source = samples.get(mapping["bone"])
            point = source.get(mapping["point"]) if source else None
            if point is not None:
                joints[joint] = {
                    "x": point[0],
                    "y": point[1],
                    "z": point[2],
                    "visibility": 1.0,
                }
        return {"timestamp": timestamp, "joints": joints}


class CanonicalSkeletonNormalizer:
    """Shoulder-centers and scales by 3D shoulder span, with a bbox fallback."""

    def normalize(self, frame: dict[str, Any]) -> dict[str, Any]:
        joints = frame["joints"]
        left = joints.get("leftShoulder")
        right = joints.get("rightShoulder")
        if left and right:
            origin = tuple((left[axis] + right[axis]) / 2 for axis in ("x", "y", "z"))
            scale = max(math.dist(
                tuple(left[key] for key in ("x", "y", "z")),
                tuple(right[key] for key in ("x", "y", "z")),
            ), 0.04)
        elif joints:
            points = list(joints.values())
            axes = ("x", "y", "z")
            minima = [min(point[axis] for point in points) for axis in axes]
            maxima = [max(point[axis] for point in points) for axis in axes]
            origin = tuple((low + high) / 2 for low, high in zip(minima, maxima))
            scale = max(*(high - low for low, high in zip(minima, maxima)), 0.04)
        else:
            origin, scale = (0.0, 0.0, 0.0), 1.0

        normalized = {}
        for joint, point in joints.items():
            normalized[joint] = {
                "x": (point["x"] - origin[0]) / scale,
                "y": (point["y"] - origin[1]) / scale,
                "z": (point["z"] - origin[2]) / scale,
                "visibility": point.get("visibility", 1.0),
            }
        return {"timestamp": frame["timestamp"], "joints": normalized}


def blender_position_to_peter_space(position: Any, matrix: Any) -> tuple[float, float, float]:
    """Blender character convention: +X right, +Z up, -Y forward."""
    world = matrix @ position
    return (float(world.x), float(world.z), float(-world.y))


def parse_arguments() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Input .blend, .glb, .gltf or .fbx file")
    parser.add_argument("--output", required=True, help="Output .template.json file")
    parser.add_argument("--bone-map", required=True, help="JSON map from canonical joints to source bones")
    parser.add_argument("--gloss", default="OBRIGADO")
    parser.add_argument("--action", help="Exact Blender action name; required if none is active")
    parser.add_argument("--armature", help="Armature object name; defaults only when exactly one exists")
    parser.add_argument("--fps", type=float, default=30.0)
    return parser.parse_args(raw)


def import_source(bpy: Any, source: Path) -> None:
    extension = source.suffix.lower()
    if extension == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(source))
    elif extension in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(source))
    elif extension == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source))
    else:
        raise ValueError(f"Unsupported input format: {extension}")


def export_template(bpy: Any, args: argparse.Namespace, bone_map: dict[str, Any]) -> None:
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    if args.armature:
        armature = bpy.data.objects.get(args.armature)
        if armature is None or armature.type != "ARMATURE":
            raise ValueError(f"Armature not found: {args.armature}")
    elif len(armatures) == 1:
        armature = armatures[0]
    else:
        raise ValueError("Select --armature; the scene must identify one animated armature.")

    if args.action:
        action = bpy.data.actions.get(args.action)
        if action is None:
            raise ValueError(f"Action not found: {args.action}")
        armature.animation_data_create()
        armature.animation_data.action = action
        if getattr(action, "slots", None) and hasattr(armature.animation_data, "action_slot"):
            slot = next(
                (candidate for candidate in action.slots
                 if getattr(candidate, "target_id_type", "") == "OBJECT"),
                None,
            )
            if slot is None:
                raise ValueError(f"Action {action.name} has no object-target animation slot.")
            armature.animation_data.action_slot = slot
    else:
        action = armature.animation_data.action if armature.animation_data else None
        if action is None:
            raise ValueError("No active action. Provide its exact name with --action.")

    for joint, mapping in bone_map.items():
        if mapping["bone"] not in armature.data.bones:
            raise ValueError(f"Bone for {joint} not found in armature: {mapping['bone']}")
    missing_body = set(BODY_JOINTS) - set(bone_map)
    if missing_body:
        raise ValueError(
            "Map the full canonical body so camera and template vectors have identical joints; "
            f"missing: {', '.join(sorted(missing_body))}"
        )
    mapped_joints = set(bone_map)
    complete_hand = False
    for side in ("left", "right"):
        required_hand = {f"{side}HandWrist"} | {
            f"{side}{finger}{index}"
            for finger, _start in FINGERS
            for index in range(1, 5)
        }
        if required_hand.issubset(mapped_joints):
            complete_hand = True
            break
    if not complete_hand:
        raise ValueError(
            "Map one hand wrist and all four joints of each of its five fingers; "
            "a single hand point cannot represent hand configuration."
        )

    scene = bpy.context.scene
    source_fps = scene.render.fps / scene.render.fps_base
    start, end = action.frame_range
    if end <= start:
        raise ValueError(f"Action {action.name} does not span multiple timeline frames.")
    duration = (end - start) / source_fps
    frame_count = max(2, int(math.ceil(duration * args.fps)) + 1)
    mapper = AnimationSkeletonMapper(bone_map)
    normalizer = CanonicalSkeletonNormalizer()
    frames = []
    missing_bones: set[str] = set()

    for index in range(frame_count):
        seconds = min(index / args.fps, duration)
        source_frame = start + seconds * source_fps
        whole = math.floor(source_frame)
        scene.frame_set(whole, subframe=source_frame - whole)
        evaluated = armature.evaluated_get(bpy.context.evaluated_depsgraph_get())
        samples = {}
        for mapping in bone_map.values():
            name = mapping["bone"]
            if name in samples:
                continue
            pose_bone = evaluated.pose.bones.get(name)
            if pose_bone is None:
                missing_bones.add(name)
                continue
            samples[name] = {
                endpoint: blender_position_to_peter_space(
                    getattr(pose_bone, endpoint), evaluated.matrix_world
                )
                for endpoint in ("head", "tail")
            }
        frame = mapper.map(samples, round(seconds * 1000))
        left_shoulder = frame["joints"].get("leftShoulder")
        right_shoulder = frame["joints"].get("rightShoulder")
        if left_shoulder is None or right_shoulder is None:
            raise ValueError(f"Shoulder joints are unavailable at sampled frame {index}.")
        shoulder_span = math.dist(
            tuple(left_shoulder[axis] for axis in ("x", "y", "z")),
            tuple(right_shoulder[axis] for axis in ("x", "y", "z")),
        )
        if not math.isfinite(shoulder_span) or shoulder_span < 0.04:
            raise ValueError(f"Invalid shoulder span at sampled frame {index}: {shoulder_span}.")
        frames.append(normalizer.normalize(frame))

    selected_joints = [joint for joint in JOINTS if joint in bone_map]
    if missing_bones:
        raise ValueError(
            "Mapped bones were unavailable while evaluating the animation: "
            + ", ".join(sorted(missing_bones))
        )
    if len(frames) < 2:
        raise ValueError("The selected action did not produce at least two frames.")
    incomplete_frames = [
        index for index, frame in enumerate(frames)
        if any(joint not in frame["joints"] for joint in selected_joints)
    ]
    if incomplete_frames:
        raise ValueError(
            "Mapped joints are missing from sampled frame(s): "
            + ", ".join(str(index) for index in incomplete_frames[:10])
        )
    if any(
        not math.isfinite(value)
        for frame in frames
        for point in frame["joints"].values()
        for value in (point["x"], point["y"], point["z"])
    ):
        raise ValueError("Normalization produced non-finite joint coordinates.")
    template = {
        "version": 1,
        "id": (
            f"{args.gloss.lower()}-{Path(args.input).stem.lower().replace(' ', '-')}-"
            f"{action.name.lower().replace(' ', '-')}"
        ),
        "name": args.gloss,
        "gloss": args.gloss,
        "frames": frames,
        "duration": round(duration, 4),
        "fps": args.fps,
        "relevantJoints": selected_joints,
        "metadata": {
            "source": "offline-animation-import",
            "sourceFileName": Path(args.input).name,
            "sourceFormat": Path(args.input).suffix.lower().lstrip("."),
            "action": action.name,
            "armature": armature.name,
            "coordinateSystem": "peter-right-up-forward",
            "normalization": "shoulder-midpoint-and-3d-span",
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
    preview = {
        "sign": args.gloss,
        "samples": [
            {
                "frame": index,
                "timestamp": frames[index]["timestamp"],
                "joints": frames[index]["joints"],
            }
            for index in sorted({0, len(frames) // 2, len(frames) - 1})
        ],
    }
    preview_path = output.with_name(f"{output.stem}.preview.json")
    preview_path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")

    hands = {}
    for side in ("left", "right"):
        hand_joints = {f"{side}HandWrist"} | {
            f"{side}{finger}{index}"
            for finger, _start in FINGERS
            for index in range(1, 5)
        }
        hands[side] = len(hand_joints & set(selected_joints))
    missing = [joint for joint in JOINTS if joint not in selected_joints]
    print(f"Sign: {args.gloss}")
    print(f"Frames: {len(frames)}")
    print(f"Duration: {duration:.2f} s")
    print(f"FPS: {args.fps:g}")
    print(f"Bones mapped: {len(selected_joints)} / {len(JOINTS)} canonical joints")
    print(f"Hands mapped: left {hands['left']} / 21; right {hands['right']} / 21")
    print(f"Missing: {missing}")
    print("Normalization: OK")
    print("Template: VALID")
    print(f"Template file: {output}")
    print(f"Preview: {preview_path}")
    print(f"Exported {len(frames)} frames ({duration:.3f}s @ {args.fps:g} FPS).")


def main() -> None:
    args = parse_arguments()
    if args.fps <= 0:
        raise ValueError("--fps must be greater than zero.")
    source = Path(args.input).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Animation input not found: {source}")
    bone_map_path = Path(args.bone_map).resolve()
    bone_map = json.loads(bone_map_path.read_text(encoding="utf-8"))
    if not isinstance(bone_map, dict):
        raise ValueError("Bone map JSON must be an object keyed by canonical joint names.")

    import bpy  # type: ignore[import-not-found]

    import_source(bpy, source)
    export_template(bpy, args, bone_map)


if __name__ == "__main__":
    main()
