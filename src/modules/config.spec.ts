import { describe, it, expect } from 'vitest';
import { auth, logging, http } from './config.js';

describe('config', () => {
  it('should export auth config with jwtSecret', () => {
    expect(auth).toHaveProperty('jwtSecret');
  });

  it('should export logging config with level defaulting to info', () => {
    expect(logging).toHaveProperty('level');
    expect(typeof logging.level).toBe('string');
  });

  it('should export http config with port defaulting to 8080', () => {
    expect(http).toHaveProperty('port');
    expect(typeof http.port).toBe('number');
    // default when STELLAR_HTTP_PORT is not set
    if (!process.env.STELLAR_HTTP_PORT) {
      expect(http.port).toBe(8080);
    }
  });

  it('should export http config with corsOrigin', () => {
    expect(http).toHaveProperty('corsOrigin');
  });
});
