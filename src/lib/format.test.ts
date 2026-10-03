import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtCompact, fmtNumber, fmtPctAuto, fmtRatio, minDigitsFor, parseNumber } from './format';

describe('persian number utilities', () => {
  it('parses the unicode minus sign pasted from rendered output', () => {
    assert.equal(parseNumber('−۵'), -5);
    assert.equal(parseNumber('−1,234'), -1234);
    assert.equal(parseNumber('۱۲٫۵'), 12.5);
    assert.equal(parseNumber(''), null);
  });

  it('formats ratios and compacts without leaking raw numerics', () => {
    assert.equal(fmtRatio(Infinity), '∞');
    assert.equal(fmtRatio(NaN), '—');
    assert.ok(!/\d/.test(fmtNumber(1234567)));
    assert.ok(fmtCompact(2_500_000_000).includes('میلیارد'));
  });

  it('does not render the product deposit rate 0.01% as a misleading zero', () => {
    assert.equal(minDigitsFor(0.01), 2);
    assert.equal(fmtPctAuto(0.01), '۰٫۰۱٪');
    assert.equal(fmtPctAuto(0), '۰٪');
  });
});
