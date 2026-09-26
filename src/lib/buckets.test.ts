import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketCountFor, bucketSizeFor, bucketSizeForRows, DEFAULT_HORIZON, horizonOf } from './buckets';
import { simulate } from './engine';
import { computeRegulatory, DEFAULT_REGULATORY } from './regulatory';
import { tierAttribution } from './attribution';
import { tierColor } from './presets';
import { presetInput } from './testUtils';

const rowsFor = (horizon: number) =>
  simulate({ ...presetInput('sample-2'), config: { ...presetInput('sample-2').config, horizon } }, true).rows;

describe('time bucketing — one rule shared by the ladder and the heat map', () => {
  it('keeps the documented horizon boundaries', () => {
    assert.equal(bucketSizeFor(12), 1);
    assert.equal(bucketSizeFor(24), 1);
    assert.equal(bucketSizeFor(25), 3);
    assert.equal(bucketSizeFor(60), 3);
    assert.equal(bucketSizeFor(61), 6);
    assert.equal(bucketSizeFor(180), 6);
    assert.equal(bucketSizeFor(181), 12);
    assert.equal(bucketSizeFor(600), 12);
    assert.equal(bucketSizeFor(NaN), bucketSizeFor(DEFAULT_HORIZON));
  });

  it('reads the horizon from the last row month, not from the row count', () => {
    // ردیف‌های موتور از ماه صفر شروع می‌شوند، پس rows.length === horizon + 1
    for (const horizon of [12, 24, 25, 60, 61, 120]) {
      const rows = rowsFor(horizon);
      assert.equal(rows.length, horizon + 1);
      assert.equal(horizonOf(rows), horizon);
      assert.equal(bucketSizeForRows(rows), bucketSizeFor(horizon));
    }
    assert.equal(horizonOf([]), 0);
  });

  it('gives the default 60-month horizon the documented 3-month buckets', () => {
    const rows = rowsFor(60);
    const reg = computeRegulatory(rows, DEFAULT_REGULATORY);
    const attr = tierAttribution(rows, tierColor);
    assert.equal(reg.bucketSize, 3, 'a 60-month horizon must not fall into the 61-row / 6-month branch');
    assert.equal(attr.heat.bucketSize, reg.bucketSize, 'the ladder and the heat map must share one grid');
  });

  it('covers every month exactly once at the boundaries where the size changes', () => {
    for (const horizon of [24, 25, 60, 61, 180, 181]) {
      const rows = rowsFor(horizon);
      const reg = computeRegulatory(rows, DEFAULT_REGULATORY);
      assert.equal(reg.bucketSize, bucketSizeFor(horizon));
      assert.equal(reg.buckets.length, bucketCountFor(rows.length, reg.bucketSize));
      let covered = 0;
      reg.buckets.forEach((b, i) => {
        assert.equal(b.from, i === 0 ? 0 : reg.buckets[i - 1].to + 1);
        covered += b.to - b.from + 1;
      });
      assert.equal(covered, rows.length, `horizon ${horizon} must be partitioned exactly once`);
      assert.equal(reg.buckets[reg.buckets.length - 1].to, horizon);
    }
  });

  it('never divides by zero or builds empty buckets', () => {
    assert.equal(bucketCountFor(0, 3), 0);
    assert.equal(bucketCountFor(10, 0), 10);
    assert.equal(bucketCountFor(NaN, NaN), 0);
    assert.deepEqual(computeRegulatory([], DEFAULT_REGULATORY).buckets, []);
    assert.deepEqual(tierAttribution([], tierColor).heat.cells, []);
  });
});
