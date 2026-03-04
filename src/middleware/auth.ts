import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { auth } from '../modules/config.js';

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token =
    req.header('x-auth-token') ||
    req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, auth.jwtSecret as string) as {
      user: { id: number };
    };
    req.user = decoded.user;
    next();
  } catch {
    return res.status(401).json({ msg: 'Token is not valid' });
  }
};
