import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { db, auth } from '../config/firebaseAdmin';
import admin from '../config/firebaseAdmin';

const router = Router();

// All admin routes require auth + admin check
router.use(authMiddleware, adminMiddleware);

// ============================================
// Auth User Management
// ============================================

/**
 * GET /api/admin/users
 * List all Firebase Auth users
 */
router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.listUsers(1000);
    const users = result.users.map((u) => ({
      uid: u.uid,
      email: u.email || '',
      displayName: u.displayName || '',
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      createdAt: u.metadata.creationTime,
      lastSignIn: u.metadata.lastSignInTime || null,
    }));
    res.json({ success: true, users, total: users.length });
  })
);

/**
 * GET /api/admin/users/:uid
 * Get a specific Auth user
 */
router.get(
  '/users/:uid',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await auth.getUser(req.params.uid);
    res.json({
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        createdAt: user.metadata.creationTime,
        lastSignIn: user.metadata.lastSignInTime,
        providers: user.providerData.map((p) => p.providerId),
      },
    });
  })
);

/**
 * DELETE /api/admin/users/:uid
 * Delete a user from Firebase Auth
 */
router.delete(
  '/users/:uid',
  asyncHandler(async (req: Request, res: Response) => {
    await auth.deleteUser(req.params.uid);
    // Also delete their Firestore data
    try {
      await db.collection('userUsage').doc(req.params.uid).delete();
    } catch (_) {
      // Non-blocking if Firestore doc doesn't exist
    }
    console.log(`🗑️ Admin ${req.user?.email} deleted user ${req.params.uid}`);
    res.json({ success: true, message: 'User deleted' });
  })
);

// ============================================
// Usage / Credits Management
// ============================================

/**
 * GET /api/admin/usage
 * List all userUsage docs
 */
router.get(
  '/usage',
  asyncHandler(async (req: Request, res: Response) => {
    const snap = await db.collection('userUsage').get();
    const usage = snap.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));
    res.json({ success: true, usage, total: usage.length });
  })
);

/**
 * PUT /api/admin/usage/:uid/credits
 * Set credits for a user
 * Body: { credits: number }
 */
router.put(
  '/usage/:uid/credits',
  asyncHandler(async (req: Request, res: Response) => {
    const { credits } = req.body;
    if (typeof credits !== 'number' || credits < 0) {
      throw new AppError('credits must be a non-negative number', 400);
    }

    const ref = db.collection('userUsage').doc(req.params.uid);
    const doc = await ref.get();

    if (doc.exists) {
      await ref.update({ credits });
    } else {
      await ref.set({
        credits,
        totalGenerations: 0,
        email: '',
        createdAt: new Date().toISOString(),
      });
    }

    console.log(`💰 Admin ${req.user?.email} set credits for ${req.params.uid} → ${credits}`);
    res.json({ success: true, uid: req.params.uid, credits });
  })
);

// ============================================
// Credit Requests Management (continued below)
// ============================================

/**
 * PUT /api/admin/usage/:uid/approve
 * Approve or revoke a user's access.
 * Body: { approved: boolean, grantStartingCredits?: boolean }
 * When approved with grantStartingCredits, sets credits to dailyCreditIncrement (10)
 * if the user currently has 0 credits.
 */
router.put(
  '/usage/:uid/approve',
  asyncHandler(async (req: Request, res: Response) => {
    const { approved, grantStartingCredits } = req.body;
    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400);
    }

    const ref = db.collection('userUsage').doc(req.params.uid);
    const doc = await ref.get();

    const updates: Record<string, any> = { approved };

    if (approved && grantStartingCredits) {
      const currentCredits = doc.exists ? (doc.data()?.credits ?? 0) : 0;
      if (currentCredits === 0) {
        updates.credits = 10; // Grant starting credits
      }
    }

    if (doc.exists) {
      await ref.update(updates);
    } else {
      await ref.set({
        credits: updates.credits ?? 0,
        totalGenerations: 0,
        email: '',
        displayName: '',
        createdAt: new Date().toISOString(),
        approved,
      });
    }

    console.log(`✅ Admin ${req.user?.email} ${approved ? 'approved' : 'revoked'} user ${req.params.uid}${updates.credits ? ` (+${updates.credits} starting credits)` : ''}`);
    res.json({ success: true, uid: req.params.uid, approved, credits: updates.credits });
  })
);


/**
 * GET /api/admin/requests
 * List recent generation requests (last 50)
 */
router.get(
  '/requests',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const snap = await db
      .collection('userRequests')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const requests = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        email: data.email,
        type: data.type,
        prompt: data.prompt,
        improvedPrompt: data.improvedPrompt,
        language: data.language,
        style: data.style,
        outfitMode: data.outfitMode,
        inputImageProvided: data.inputImageProvided,
        generatedImageUrl: data.generatedImageUrl,
        generationTimeMs: data.generationTimeMs,
        success: data.success,
        timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ success: true, requests, total: requests.length });
  })
);

// ============================================
// Credit Requests Management
// ============================================

/**
 * GET /api/admin/credit-requests
 * List all credit requests
 */
router.get(
  '/credit-requests',
  asyncHandler(async (req: Request, res: Response) => {
    const snap = await db
      .collection('creditRequests')
      .orderBy('createdAt', 'desc')
      .get();

    const requests = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        email: data.email,
        message: data.message,
        requestedCredits: data.requestedCredits || 0,
        approvedCredits: data.approvedCredits,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ success: true, requests, total: requests.length });
  })
);

/**
 * PUT /api/admin/credit-requests/:id
 * Approve or deny a credit request
 * Body: { status: 'approved' | 'denied', credits?: number }
 * If approved with credits, also adds credits to the user's userUsage doc.
 */
router.put(
  '/credit-requests/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { status, credits } = req.body;
    if (!['approved', 'denied'].includes(status)) {
      throw new AppError('status must be "approved" or "denied"', 400);
    }

    const reqRef = db.collection('creditRequests').doc(req.params.id);
    const reqDoc = await reqRef.get();

    if (!reqDoc.exists) {
      throw new AppError('Credit request not found', 404);
    }

    const data = reqDoc.data()!;

    // Update request status
    await reqRef.update({
      status,
      approvedCredits: status === 'approved' ? (credits || 0) : 0,
      reviewedBy: req.user?.email,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // If approved with credits, atomically add to user's balance
    // Uses FieldValue.increment() to avoid race conditions with concurrent generations
    if (status === 'approved' && typeof credits === 'number' && credits > 0) {
      const usageRef = db.collection('userUsage').doc(data.userId);
      const usageDoc = await usageRef.get();

      if (usageDoc.exists) {
        await usageRef.update({
          credits: admin.firestore.FieldValue.increment(credits),
        });
      } else {
        await usageRef.set({
          credits,
          totalGenerations: 0,
          email: data.email || '',
          displayName: '',
          createdAt: new Date().toISOString(),
        });
      }
    }

    console.log(`📩 Admin ${req.user?.email} ${status} credit request ${req.params.id}${credits ? ` (+${credits} credits)` : ''}`);
    res.json({ success: true, message: `Request ${status}`, credits: credits || 0 });
  })
);

// ============================================
// Dashboard Stats
// ============================================

/**
 * GET /api/admin/stats
 * Get summary statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    // Count Auth users
    const authResult = await auth.listUsers(1000);
    const totalUsers = authResult.users.length;

    // Get usage data
    const usageSnap = await db.collection('userUsage').get();
    let totalGenerations = 0;
    let activeUsers = 0;
    let totalCreditsInCirculation = 0;

    usageSnap.docs.forEach((doc) => {
      const data = doc.data();
      const userGenerations = parseInt(data.totalGenerations as any) || 0;
      const userCredits = parseInt(data.credits as any) || 0;
      
      totalGenerations += userGenerations;
      totalCreditsInCirculation += userCredits;
      if (userCredits > 0) activeUsers++;
    });

    // Count pending credit requests
    const pendingSnap = await db
      .collection('creditRequests')
      .where('status', '==', 'pending')
      .get();

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalGenerations,
        activeUsers,
        totalCreditsInCirculation,
        pendingCreditRequests: pendingSnap.size,
      },
    });
  })
);

/**
 * GET /api/admin/check
 * Lightweight endpoint to check if the current user is an admin
 */
router.get('/check', (req: Request, res: Response) => {
  res.json({ success: true, isAdmin: true, email: req.user?.email });
});

export default router;
