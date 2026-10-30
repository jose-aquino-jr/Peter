# VLibras SIM animation proof of concept

`vlibras-sim.animation.json` is generated from the UnityPy inspection report, not hand-authored:

```powershell
python tools/convert_vlibras_report.py `
  "$env:TEMP\Peter-VLibras-SIM\bundle-report.json" `
  src/avatar/animations/vlibras-sim.animation.json
```

The asset preserves all 274 curves and their original key times, values, slopes, source paths, and categories. Runtime playback uses the greatest key time (3.400000095 s); the Unity `MuscleClip.stopTime` (1 s) is retained as metadata because it conflicts with the curve timeline. This choice follows the data available, but the dictionary player's intended duration remains unconfirmed.

## Retargeting used in the experimental player

Exact source transform paths map as follows:

| Unity source path suffix | VRM normalized bone |
| --- | --- |
| `BnOmbro.L/BnBraco.L` | `leftUpperArm` |
| `.../BnAntBraco.L` | `leftLowerArm` |
| `.../BnAntBraco.L.001/BnMao.L` | `leftHand` |
| `BnOmbro.R/BnBraco.R` | `rightUpperArm` |
| `.../BnAntBraco.R` | `rightLowerArm` |
| `.../BnAntBraco.R.001/BnMao.R` | `rightHand` |

The `BnAntBraco.*.001` twist transforms are omitted because the VRM has no corresponding humanoid twist bone. `getNormalizedBoneNode()` is used to access the target bones, which are verified in Peter's `avatar.vrm` humanoid extension and supported by the installed three-vrm 3.5.5 types.

An experimental local-delta player exists in `vlibras-animation.ts`, but it is not connected to the SIM button. The first retarget attempt applied world rotations independently and drove the arm behind the torso. A subsequent local-delta attempt also did not produce a correct pose in the Peter VRM. These failures show that mathematical correctness of the Unity-to-Three basis reflection alone is insufficient: the source and target local bone axes need an explicit bind-pose alignment.

The SIM button is intentionally disabled until that source data is available. The UnityFS bundle contains the AnimationClip curves and transform paths, but does not include the source rig's rest transforms, Avatar/HumanDescription, or source-to-humanoid bone mapping. The first animation key is not a substitute for the source bind pose. Request the original FBX or Blender armature with rest pose, or Unity Avatar/HumanDescription plus the source hierarchy and bind transforms. Without one of these, the local-axis alignment needed to produce the same arm/hand orientation on Peter cannot be recovered from this clip alone. The current animation is therefore not marked functional or linguistically validated.

## Deliberately unmapped channels

- `BnDedo.1.*` through numbered sibling paths contain animated finger rotations, but the bundle does not label those groups as thumb/index/middle/ring/little and provides no rig or rest pose. They are left unmapped; assigning digits by sibling order would be an unverified assumption.
- The two `.001` forearm twist nodes have no VRM humanoid counterpart and are not retargeted.
- Position curves are not applied. Most are static, while the varying local offsets include facial and finger nodes whose source rest transforms are unavailable.
- Scale curves are static in this clip and are not applied.
- Scalar curves target source blendshapes under `cabecaModifAlisson`; no equivalent target expression mapping was verified, so they are not applied.

This is an experimental partial retarget of source rotations, not a validated Libras rendering. The original source rig (FBX/Blend or Unity Avatar/HumanDescription plus bind pose and bone semantics) is still needed to map the fingers and establish the source coordinate/rest basis confidently. The test-only browser control is enabled with `?librasTest=1` in development.
