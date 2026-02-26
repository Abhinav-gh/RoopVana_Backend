import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/firebaseAdmin';

// Extend Express Request to carry authenticated user info
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
      };
    }
  }
}

/**
 * Middleware to verify Firebase ID tokens.
 * Extracts the Bearer token from the Authorization header,
 * verifies it with Firebase Auth, and attaches user info to req.user.
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer <idToken>',
      statusCode: 401,
    });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || '',
    };
    next();
  } catch (error: any) {
    console.error('❌ Firebase auth verification failed:', error.message);
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token. Please log in again.',
      statusCode: 401,
    });
    return;
  }
};
