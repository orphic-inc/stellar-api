import { FileType } from '@prisma/client';
import { gradeContribution } from './contributionQuality';

describe('gradeContribution', () => {
  it('grades a logged + cued lossless rip as Perfect', () => {
    const q = gradeContribution({
      type: FileType.flac,
      bitrate: 'Lossless',
      hasLog: true,
      hasCue: true
    });
    expect(q).toEqual({ tier: 'Perfect', score: 1 });
  });

  it('grades lossless without a log/cue as Lossless', () => {
    expect(gradeContribution({ type: FileType.flac }).tier).toBe('Lossless');
    expect(gradeContribution({ type: FileType.wav }).tier).toBe('Lossless');
    // log/cue only lift FLAC-class formats; they do not apply to WAV
    expect(gradeContribution({ type: FileType.flac }).score).toBe(0.9);
  });

  it('grades 320 / V0 lossy as HighLossy', () => {
    expect(gradeContribution({ type: FileType.mp3, bitrate: '320' }).tier).toBe(
      'HighLossy'
    );
    expect(gradeContribution({ type: FileType.mp3, bitrate: 'V0' }).tier).toBe(
      'HighLossy'
    );
  });

  it('grades V2 / 256 lossy as MidLossy', () => {
    expect(gradeContribution({ type: FileType.mp3, bitrate: 'V2' }).tier).toBe(
      'MidLossy'
    );
    expect(gradeContribution({ type: FileType.aac, bitrate: '256' }).tier).toBe(
      'MidLossy'
    );
  });

  it('grades 128 and below as LowLossy', () => {
    expect(gradeContribution({ type: FileType.mp3, bitrate: '128' }).tier).toBe(
      'LowLossy'
    );
  });

  it('returns Unknown (null score) for lossy with no parseable bitrate', () => {
    const q = gradeContribution({ type: FileType.mp3, bitrate: null });
    expect(q).toEqual({ tier: 'Unknown', score: null });
  });

  it('returns Unknown for a non-audio format', () => {
    expect(gradeContribution({ type: FileType.zip }).tier).toBe('Unknown');
  });

  it('normalises messy bitrate strings (case, spacing, kbps suffix)', () => {
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: ' 320 kbps ' }).tier
    ).toBe('HighLossy');
  });
});
