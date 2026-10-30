function euclidean(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export function dtwDistance(
  query: readonly (readonly number[])[],
  template: readonly (readonly number[])[],
  windowRatio = 0.28,
): number {
  const n = query.length;
  const m = template.length;
  if (n === 0 || m === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const window = Math.max(
    1,
    Math.abs(n - m),
    Math.ceil(Math.max(n, m) * windowRatio),
  );
  const prev = new Float64Array(m + 1).fill(Number.POSITIVE_INFINITY);
  const curr = new Float64Array(m + 1).fill(Number.POSITIVE_INFINITY);
  prev[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    curr.fill(Number.POSITIVE_INFINITY);
    const jStart = Math.max(1, i - window);
    const jEnd = Math.min(m, i + window);
    for (let j = jStart; j <= jEnd; j += 1) {
      const cost = euclidean(query[i - 1], template[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.set(curr);
  }

  const pathCost = prev[m];
  return pathCost / (n + m);
}

export function dtwSimilarity(
  query: readonly (readonly number[])[],
  template: readonly (readonly number[])[],
  windowRatio = 0.28,
): number {
  const distance = dtwDistance(query, template, windowRatio);
  if (!Number.isFinite(distance)) {
    return 0;
  }
  return 1 / (1 + distance);
}
