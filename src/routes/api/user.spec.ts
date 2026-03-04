import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock Prisma before importing the router
vi.mock('../../modules/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    userRank: {
      findFirst: vi.fn()
    }
  }
}));

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn()
  }
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    genSalt: vi.fn().mockResolvedValue('salt'),
    hash: vi.fn().mockResolvedValue('hashed-password'),
    compare: vi.fn()
  }
}));

// Mock gravatar
vi.mock('gravatar', () => ({
  default: {
    url: vi.fn().mockReturnValue('https://gravatar.com/avatar/test')
  }
}));

import userRouter from './user.js';
import { prisma } from '../../modules/prisma.js';

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);

const mockedPrisma = vi.mocked(prisma);

describe('POST /api/user (register)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if username is missing', async () => {
    const res = await request(app).post('/api/user').send({
      email: 'test@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('should return 400 if email is invalid', async () => {
    const res = await request(app).post('/api/user').send({
      username: 'testuser',
      email: 'not-an-email',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('should return 400 if password is too short', async () => {
    const res = await request(app).post('/api/user').send({
      username: 'testuser',
      email: 'test@example.com',
      password: '123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('should return 400 if user already exists', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'test@example.com'
    } as any);

    const res = await request(app).post('/api/user').send({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].msg).toBe('User already exists');
  });

  it('should return token on successful registration', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.userRank.findFirst.mockResolvedValue({
      id: 1,
      name: 'Default',
      level: 100
    } as any);
    mockedPrisma.user.create.mockResolvedValue({
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
      avatar: 'https://gravatar.com/avatar/test'
    } as any);

    const res = await request(app).post('/api/user').send({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('mock-token');
    expect(res.body.user).toHaveProperty('id');
  });
});

describe('POST /api/user/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if email is missing', async () => {
    const res = await request(app).post('/api/user/login').send({
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('should return 400 if user not found', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post('/api/user/login').send({
      email: 'test@example.com',
      password: 'password123'
    });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].msg).toBe('Invalid credentials');
  });
});
