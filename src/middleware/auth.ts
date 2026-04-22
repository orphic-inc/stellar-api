import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { auth as authConfig } from '../modules/config';

interface JwtPayload {
  user: { id: number };
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ msg: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret) as JwtPayload;
    req.user = decoded.user;
    next();
  } catch {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};
