import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { db } from '../config/firebaseAdmin';
import admin from '../config/firebaseAdmin';
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
 * Uses a Firestore transaction to atomically check AND deduct 1 credit,
 * preventing race conditions when the same user sends concurrent requests.
 *
 * Flow:
 *   1. Begin transaction → read userUsage doc
 *   2. If doc doesn't exist → create with 0 credits, abort (no credits)
 *   3. If credits <= 0 → abort (no credits)
 *   4. Deduct 1 credit + increment totalGenerations → commit
 *
 * Because the check and deduction happen inside a single transaction,
 * two simultaneous requests can never both succeed on the last credit.
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

    const result = await db.runTransaction(async (transaction) => {
      const usageDoc = await transaction.get(usageRef);

      if (!usageDoc.exists) {
        // First-time user — create doc with 0 credits
        transaction.set(usageRef, {
          credits: 0,
          totalGenerations: 0,
          email: req.user?.email || '',
          displayName: req.user?.displayName || '',
          createdAt: new Date().toISOString(),
        });
        return { success: false as const, credits: 0 };
      }

      const data = usageDoc.data()!;
      const currentCredits = data.credits ?? 0;

      if (currentCredits <= 0) {
        return { success: false as const, credits: 0 };
      }

      // Atomically deduct 1 credit and increment generation count
      const newCredits = currentCredits - 1;
      transaction.update(usageRef, {
        credits: newCredits,
        totalGenerations: (data.totalGenerations || 0) + 1,
      });

      return { success: true as const, credits: newCredits };
    });

    if (!result.success) {
      res.status(429).json({
        success: false,
        error: 'No Credits',
        message: 'You have no generation credits remaining. Please request more credits to continue.',
        statusCode: 429,
        credits: 0,
      });
      return;
    }

    // Attach remaining credits to request for use in response
    (req as any).currentCredits = result.credits;
    next();
  } catch (error: any) {
    console.error('❌ Error in credit transaction:', error.message);
    // On Firestore error, allow the request (fail open)
    (req as any).currentCredits = -1;
    next();
  }
};

/**
 * Refund 1 credit to a user after a failed generation.
 * Uses FieldValue.increment for atomicity — safe even during concurrent operations.
 * Also decrements totalGenerations since the generation didn't complete.
 */
export const refundUserCredit = async (uid: string): Promise<void> => {
  try {
    const usageRef = db.collection('userUsage').doc(uid);
    await usageRef.update({
      credits: admin.firestore.FieldValue.increment(1),
      totalGenerations: admin.firestore.FieldValue.increment(-1),
    });
    console.log(`🔄 Refunded 1 credit to user ${uid} (generation failed)`);
  } catch (error: any) {
    console.error(`❌ Error refunding credit for ${uid}:`, error.message);
  }
};