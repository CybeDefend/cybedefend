import { describe, it, expect } from 'vitest';
import { sparklinePoints, SPARK_WIDTH, SPARK_HEIGHT } from './sparklinePoints';

const parse = (points: string) => points.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

describe('sparklinePoints: a series as one polyline in a fixed box', () => {
  it('spans the box from the first reading to the last', () => {
    const pts = parse(sparklinePoints([1, 2, 3])!);
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(0);
    expect(pts[2][0]).toBe(SPARK_WIDTH);
  });

  it('puts the highest reading at the top and the lowest at the bottom, inside the stroke margin', () => {
    const pts = parse(sparklinePoints([10, 0, 5])!);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(pts[0][1]);
    expect(Math.max(...ys)).toBe(pts[1][1]);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(SPARK_HEIGHT);
  });

  it('draws a flat series as a flat line in the middle, never a division by zero', () => {
    const points = sparklinePoints([4, 4, 4])!;
    expect(points).not.toContain('NaN');
    const ys = new Set(parse(points).map(([, y]) => y));
    expect(ys.size).toBe(1);
    expect([...ys][0]).toBe(SPARK_HEIGHT / 2);
  });

  it('leaves out the readings that are not numbers', () => {
    expect(parse(sparklinePoints([1, null, Number.NaN, 3])!)).toHaveLength(2);
  });

  it('draws nothing with fewer than two readings', () => {
    expect(sparklinePoints([])).toBeNull();
    expect(sparklinePoints([7])).toBeNull();
    expect(sparklinePoints([null, 7])).toBeNull();
    expect(sparklinePoints(undefined)).toBeNull();
  });
});
