import type { Landmark, LandmarkFrame } from "../pipeline/contracts";

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [15, 19], [16, 20],
  [0, 11], [0, 12],
];

export function drawLandmarkFrame(
  canvas: HTMLCanvasElement,
  frame: LandmarkFrame | undefined,
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) {
    return;
  }
  drawConnections(context, canvas, frame.body, POSE_CONNECTIONS, "rgba(231, 189, 88, 0.7)");
  drawPoints(context, canvas, frame.body, "rgba(241, 204, 108, 0.95)");
  drawConnections(context, canvas, frame.leftHand, HAND_CONNECTIONS, "rgba(116, 196, 164, 0.85)");
  drawPoints(context, canvas, frame.leftHand, "#7ddec0");
  drawConnections(context, canvas, frame.rightHand, HAND_CONNECTIONS, "rgba(120, 176, 232, 0.85)");
  drawPoints(context, canvas, frame.rightHand, "#8ec0ff");
}

function drawConnections(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: readonly Landmark[],
  connections: ReadonlyArray<readonly [number, number]>,
  color: string,
): void {
  context.strokeStyle = color;
  context.lineWidth = 2;
  for (const [from, to] of connections) {
    const a = points[from];
    const b = points[to];
    if (!a || !b) {
      continue;
    }
    context.beginPath();
    context.moveTo(a.x * canvas.width, a.y * canvas.height);
    context.lineTo(b.x * canvas.width, b.y * canvas.height);
    context.stroke();
  }
}

function drawPoints(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: readonly Landmark[],
  color: string,
): void {
  context.fillStyle = color;
  for (const point of points) {
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 2.4, 0, Math.PI * 2);
    context.fill();
  }
}
