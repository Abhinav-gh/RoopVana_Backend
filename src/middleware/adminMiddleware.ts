import { Request, Response, NextFunction } from 'express';
import config from '../config/env';

/**
 * Admin-only middleware.
 * Must run AFTER authMiddleware (so req.user is populated).
 * Checks if the authenticated user's email is in the ADMIN_EMAILS env var.
 */
export const adminMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const email = req.user?.email;

  if (!email || !config.adminEmails.includes(email)) {
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'You do not have admin access.',
      statusCode: 403,
    });
    return;
  }

  next();
};
