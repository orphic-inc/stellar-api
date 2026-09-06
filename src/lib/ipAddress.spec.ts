import { normalizeIp, ipInRange, denormalizeIp } from './ipAddress';

describe('normalizeIp', () => {
  it('maps IPv4 into ::ffff:0:0/96 as 32 hex chars', () => {
    expect(normalizeIp('8.8.8.8')).toBe('00000000000000000000ffff08080808');
    expect(normalizeIp('0.0.0.0')).toBe('00000000000000000000ffff00000000');
    expect(normalizeIp('255.255.255.255')).toBe(
      '00000000000000000000ffffffffffff'
    );
  });

  it('treats an IPv4-mapped IPv6 as the same address', () => {
    // req.ip yields this form on a dual-stack socket; the old parser rejected
    // it outright, so such a client could never match a ban.
    expect(normalizeIp('::ffff:8.8.8.8')).toBe(normalizeIp('8.8.8.8'));
  });

  it('expands IPv6 including `::`', () => {
    expect(normalizeIp('::1')).toBe('0'.repeat(31) + '1');
    expect(normalizeIp('2001:db8::1')).toBe('20010db8' + '0'.repeat(23) + '1');
    expect(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(
      normalizeIp('2001:db8::1')
    );
  });

  it('is case-insensitive and trims', () => {
    expect(normalizeIp('  2001:DB8::1  ')).toBe(normalizeIp('2001:db8::1'));
  });

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'not-an-ip',
      '1.2.3',
      '1.2.3.4.5',
      '256.0.0.1',
      '1.2.3.-1',
      '2001:db8::1::2',
      'gggg::1',
      '12345::1'
    ]) {
      expect(normalizeIp(bad)).toBeNull();
    }
  });

  it('rejects leading zeros so one ban cannot be written two ways', () => {
    expect(normalizeIp('010.0.0.1')).toBeNull();
  });

  it('requires :: to stand for at least one group', () => {
    expect(normalizeIp('1:2:3:4:5:6:7::8')).toBeNull();
  });
});

describe('lexicographic order equals numeric order', () => {
  it('orders IPv4 correctly ACROSS the old signed-int boundary', () => {
    // This is the property the Int columns lacked: 128.0.0.0 stored as
    // -2147483648 sorted BELOW 127.255.255.255, so a range spanning the
    // boundary could never match.
    const a = normalizeIp('127.255.255.255')!;
    const b = normalizeIp('128.0.0.0')!;
    expect(a < b).toBe(true);
  });

  it('sorts a full IPv4 ladder', () => {
    const ladder = [
      '0.0.0.0',
      '8.8.8.8',
      '127.255.255.255',
      '128.0.0.0',
      '200.0.0.1',
      '255.255.255.255'
    ];
    const norm = ladder.map((ip) => normalizeIp(ip)!);
    expect([...norm].sort()).toEqual(norm);
  });

  it('sorts IPv6 and places IPv4-mapped inside its own block', () => {
    expect(normalizeIp('::1')! < normalizeIp('8.8.8.8')!).toBe(true);
    expect(normalizeIp('8.8.8.8')! < normalizeIp('2001:db8::1')!).toBe(true);
  });
});

describe('ipInRange', () => {
  const r = (c: string, f: string, t: string) =>
    ipInRange(normalizeIp(c)!, normalizeIp(f)!, normalizeIp(t)!);

  it('matches inside an ordinary IPv4 range', () => {
    expect(r('10.0.0.5', '10.0.0.1', '10.0.0.255')).toBe(true);
    expect(r('10.0.1.5', '10.0.0.1', '10.0.0.255')).toBe(false);
  });

  it('matches a range that CROSSES the old signed boundary', () => {
    // The regression case: unrepresentable before, and accepted by the route's
    // validator, so it was a ban that silently matched nothing.
    expect(r('150.0.0.1', '100.0.0.0', '200.0.0.0')).toBe(true);
    expect(r('99.255.255.255', '100.0.0.0', '200.0.0.0')).toBe(false);
    expect(r('200.0.0.1', '100.0.0.0', '200.0.0.0')).toBe(false);
  });

  it('is inclusive at both bounds', () => {
    expect(r('10.0.0.1', '10.0.0.1', '10.0.0.255')).toBe(true);
    expect(r('10.0.0.255', '10.0.0.1', '10.0.0.255')).toBe(true);
  });

  it('matches IPv6 ranges', () => {
    expect(r('2001:db8::5', '2001:db8::1', '2001:db8::ff')).toBe(true);
    expect(r('2001:db9::5', '2001:db8::1', '2001:db8::ff')).toBe(false);
  });

  it('does not let an IPv6 client fall into an IPv4 ban', () => {
    expect(r('2001:db8::1', '0.0.0.0', '255.255.255.255')).toBe(false);
  });
});

describe('denormalizeIp', () => {
  it('round-trips IPv4 and IPv6', () => {
    for (const ip of ['8.8.8.8', '0.0.0.0', '255.255.255.255']) {
      expect(denormalizeIp(normalizeIp(ip)!)).toBe(ip);
    }
    expect(denormalizeIp(normalizeIp('2001:db8::1')!)).toBe(
      '2001:db8:0:0:0:0:0:1'
    );
  });
});
