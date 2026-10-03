import { checkValidateHandles, countBypasses } from './validateHandles';

describe('countBypasses', () => {
  it('counts each unchecked reader and direct res.locals read', () => {
    const source = [
      'const { id } = parsedParams<{ id: number }>(res);',
      'const body = parsedBody<Input>(res); const q = parsedQuery<Q>(res);',
      'const pg = parsedPage(res);',
      'const id = Number(res.locals.parsedParams.id);'
    ].join('\n');
    expect(countBypasses(source)).toBe(5);
  });

  it('ignores handle reads and comment lines', () => {
    const source = [
      'const { id } = releaseParams.read(res);',
      'const pg = pageOf(listQuery.read(res));',
      '// parsedBody<T>(res) was the old way',
      ' * and parsedPage(res) too'
    ].join('\n');
    expect(countBypasses(source)).toBe(0);
  });
});

describe('checkValidateHandles', () => {
  it('passes when every file matches its baseline', () => {
    expect(checkValidateHandles({ 'a.ts': 2 }, { 'a.ts': 2 }).ok).toBe(true);
  });

  it('fails a new file, and a file above its baseline', () => {
    const r = checkValidateHandles({ 'a.ts': 3, 'b.ts': 1 }, { 'a.ts': 2 });
    expect(r.ok).toBe(false);
    expect(r.grown.map((g) => g.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('fails a baseline left above the count, so it only shrinks', () => {
    const r = checkValidateHandles({}, { 'a.ts': 2 });
    expect(r.ok).toBe(false);
    expect(r.stale).toEqual([{ file: 'a.ts', count: 0, allowed: 2 }]);
  });
});
