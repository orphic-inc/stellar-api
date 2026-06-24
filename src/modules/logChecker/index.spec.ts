/**
 * Regression fixtures: real EAC and XLD logs with known-good outcomes.
 *
 * Both fixtures are verified-perfect rips → score 100 / isPerfect. They are the
 * source-of-truth anchors for the port; the per-scorer specs (eac.spec.ts /
 * xld.spec.ts) exercise the deduction and FAIL branches around them.
 *
 * Encoding note: real EAC logs are commonly UTF-16LE (the Loveless fixture is) and
 * must be decoded on read — checkLog's contract is "a decoded Unicode string", it
 * does not transcode raw UTF-16 bytes. The XLD fixture is UTF-8.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkLog } from './index';

const fixture = (name: string, enc: BufferEncoding): string =>
  readFileSync(join(__dirname, '__fixtures__', name), enc);

describe('checkLog — real fixtures', () => {
  it('scores a perfect EAC rip (My Bloody Valentine — Loveless) at 100', () => {
    const result = checkLog(fixture('eac-loveless.log', 'utf16le'));
    expect(result.ripper).toBe('EAC');
    expect(result.version).toBe('1.3');
    expect(result.score).toBe(100);
    expect(result.isPerfect).toBe(true);
    expect(result.deductions).toEqual([]);
  });

  it('scores a perfect XLD rip (Legend Of The Liquid Sword) at 100', () => {
    const result = checkLog(fixture('xld-liquid-sword.log', 'utf8'));
    expect(result.ripper).toBe('XLD');
    expect(result.version).toBe('20161007');
    expect(result.score).toBe(100);
    expect(result.isPerfect).toBe(true);
    expect(result.deductions).toEqual([]);
  });
});

describe('checkLog — format detection', () => {
  it('returns ripper null with a FAIL note for an unrecognized log', () => {
    const result = checkLog('this is not a rip log at all\njust some text\n');
    expect(result.ripper).toBeNull();
    expect(result.version).toBeNull();
    expect(result.score).toBe(0);
    expect(result.isPerfect).toBe(false);
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0].message).toMatch(/Unrecognized log format/);
  });

  it('clamps a stacked-deduction FAIL to a 0 floor (no negative scores)', () => {
    // An XLD header with no track blocks: the scorer drives the total below 0, but
    // the contract boundary floors it at 0.
    const result = checkLog(
      'X Lossless Decoder version 20161007 (149.3)\n' +
        'XLD extraction logfile from 2016-12-15\n' +
        'Various Artists / Album\n' +
        'Ripper mode : XLD Secure Ripper\n'
    );
    expect(result.ripper).toBe('XLD');
    expect(result.score).toBe(0);
    expect(result.isPerfect).toBe(false);
  });

  it('strips a UTF-8 BOM and a leading "Syrup" line before detection', () => {
    const eac = checkLog(
      '﻿Syrup 1.0\nExact Audio Copy V1.3 from 2. September 2016\n'
    );
    // No body follows the header, so it cannot score — but it must still detect EAC.
    expect(eac.ripper).toBe('EAC');
    expect(eac.version).toBe('1.3');
  });
});
