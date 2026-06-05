import { Bitrate, FileType } from '@prisma/client';
import { gradeContribution } from './contributionQuality';

describe('gradeContribution', () => {
  it('grades a logged + cued lossless rip as Perfect', () => {
    const q = gradeContribution({
      type: FileType.flac,
      bitrate: Bitrate.Lossless,
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
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.Kbps320 }).tier
    ).toBe('HighLossy');
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.KbpsV0 }).tier
    ).toBe('HighLossy');
  });

  it('grades V2 / 256 lossy as MidLossy', () => {
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.KbpsV2 }).tier
    ).toBe('MidLossy');
    expect(
      gradeContribution({ type: FileType.aac, bitrate: Bitrate.Kbps256 }).tier
    ).toBe('MidLossy');
  });

  it('grades 192 / 128 as LowLossy', () => {
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.Kbps128 }).tier
    ).toBe('LowLossy');
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.Kbps192 }).tier
    ).toBe('LowLossy');
  });

  it('grades a lossless marker on a lossy container as Lossless', () => {
    // e.g. ALAC carried in .m4a
    expect(
      gradeContribution({ type: FileType.m4a, bitrate: Bitrate.Lossless24 })
        .tier
    ).toBe('Lossless');
  });

  it('returns Unknown (null score) for lossy with no bitrate', () => {
    expect(gradeContribution({ type: FileType.mp3, bitrate: null })).toEqual({
      tier: 'Unknown',
      score: null
    });
  });

  it('returns Unknown for an unclassifiable (Other) bitrate', () => {
    expect(
      gradeContribution({ type: FileType.mp3, bitrate: Bitrate.Other }).tier
    ).toBe('Unknown');
  });

  it('returns Unknown for a non-audio format', () => {
    expect(gradeContribution({ type: FileType.zip }).tier).toBe('Unknown');
  });
});
