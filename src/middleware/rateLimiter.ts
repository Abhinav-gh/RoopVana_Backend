import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { db } from '../config/firebaseAdmin';
import config from '../config/env';

// General API rate limiter (IP-based, secondary defense)
export const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: {
    success: false,
    error: 'Too Many Requests',
    message: 'Too many requests from this IP, please try again later.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for speech-to-text (IP-based)
export const speechLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: 'Too Many Requests',
    message: 'Speech-to-text limit exceeded. Please wait before trying again.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Per-user credit-based generation limiter using Firestore.
 * Users start with 0 credits — admin must grant credits manually.
 * Each image generation costs 1 credit.
 * Blocks generation when credits = 0.
 */
export const userCreditLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const uid = req.user?.uid;

  if (!uid) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'User not authenticated.',
      statusCode: 401,
    });
    return;
  }

  try {
    const usageRef = db.collection('userUsage').doc(uid);
    const usageDoc = await usageRef.get();

    let credits = 0;

    if (usageDoc.exists) {
      const data = usageDoc.data()!;
      credits = data.credits ?? 0;
    } else {
      // First-time user — create doc with 0 credits
      await usageRef.set({
        credits: 0,
        totalGenerations: 0,
        createdAt: new Date().toISOString(),
      });
    }

    if (credits <= 0) {
      res.status(429).json({
        success: false,
        error: 'No Credits',
        message: 'You have no generation credits remaining. Please request more credits to continue.',
        statusCode: 429,
        credits: 0,
      });
      return;
    }

    // Attach credits info to request for use in response
    (req as any).currentCredits = credits;
    next();
  } catch (error: any) {
    console.error('❌ Error checking user credits:', error.message);
    // On Firestore error, allow the request (fail open)
    (req as any).currentCredits = -1;
    next();
  }
};

/**
 * Deduct 1 credit from user after a successful generation.
 * Returns the new credit balance.
 */
export const deductUserCredit = async (uid: string): Promise<number> => {
  try {
    const usageRef = db.collection('userUsage').doc(uid);
    const usageDoc = await usageRef.get();

    if (usageDoc.exists) {
      const data = usageDoc.data()!;
      const newCredits = Math.max(0, (data.credits ?? 0) - 1);
      await usageRef.update({
        credits: newCredits,
        totalGenerations: (data.totalGenerations || 0) + 1,
      });
      return newCredits;
    }
    return 0;
  } catch (error: any) {
    console.error('❌ Error deducting user credit:', error.message);
    return -1;
  }
};