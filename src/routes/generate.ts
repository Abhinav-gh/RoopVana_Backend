import { Router, Request, Response } from 'express';
import geminiService from '../services/gemini';
import speechToTextService from '../services/speechToText';
import { 
  GenerateImageRequest, 
  GenerateImageResponse,
  SpeechToTextRequest,
  SpeechToTextResponse,
  HealthCheckResponse 
} from '../types';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { speechLimiter, userCreditLimiter, refundUserCredit } from '../middleware/rateLimiter';
import { authMiddleware } from '../middleware/authMiddleware';
import { db } from '../config/firebaseAdmin';
import admin from '../config/firebaseAdmin';
import geminiQueue from '../services/geminiQueue';
import cloudinaryService from '../services/cloudinary';
import config from '../config/env';

const router = Router();

// ============================================
// Helper: Store user request data in Firestore
// ============================================
const storeUserRequestData = async (data: {
  userId: string;
  email: string;
  type: 'text-to-image' | 'image-to-image';
  prompt: string;
  improvedPrompt: string;
  language: string;
  style: string | null;
  outfitMode: string | null;
  inputImageProvided: boolean;
  generationTimeMs: number;
  generatedImageUrl: string | null;
  success: boolean;
}) => {
  try {
    await db.collection('userRequests').add({
      ...data,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error: any) {
    console.error('❌ Error storing user request data:', error.message);
    // Non-blocking — don't fail the response
  }
};

// ============================================
// Public routes (no auth required)
// ============================================

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response<HealthCheckResponse>) => {
  const response: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      gemini: !!process.env.GEMINI_API_KEY,
      speechToText: speechToTextService.isAvailable(),
    },
  };

  res.json(response);
});

/**
 * GET /api/languages
 * Get list of supported languages
 */
router.get('/languages', (req: Request, res: Response) => {
  const languages = [
    { code: 'hi-IN', name: 'Hindi', native: 'हिंदी' },
    { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
    { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
    { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
    { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം' },
    { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
    { code: 'en-IN', name: 'English', native: 'English' },
  ];

  res.json({ success: true, languages });
});

// ============================================
// Protected routes (auth required)
// ============================================

/**
 * POST /api/generate
 * Generate an image from text prompt
 */
router.post(
  '/generate',
  authMiddleware,
  userCreditLimiter,
  asyncHandler(async (req: Request<{}, {}, GenerateImageRequest>, res: Response<GenerateImageResponse>) => {
    const { prompt, language, style, outfitMode } = req.body;

    // Validation
    if (!prompt || !prompt.trim()) {
      // Refund since validation failed after credit was reserved
      await refundUserCredit(req.user!.uid);
      throw new AppError('Prompt is required', 400);
    }

    if (!language) {
      await refundUserCredit(req.user!.uid);
      throw new AppError('Language is required', 400);
    }

    console.log(`📝 Image generation request from ${req.user?.email}:`, { prompt: prompt.substring(0, 100) + '...', language, style, outfitMode });

    const startTime = Date.now();

    try {
      // Step 1: Improve prompt with mode-aware enhancement (handles multilingual inline)
      console.log(`✨ Improving prompt (${outfitMode || 'full'} mode)...`);
      const improvedPrompt = await geminiService.improvePrompt(prompt, outfitMode || 'full');

      // Step 2: Generate image (queued for concurrency control)
      console.log(`🎨 Generating image (queue: ${geminiQueue.getStatus().queuedCount} waiting)...`);
      const imageUrl = await geminiQueue.enqueue(() =>
        geminiService.generateImage(improvedPrompt, language)
      );

      const generationTime = Date.now() - startTime;

      // Credits already deducted atomically in the middleware transaction
      const newCredits = (req as any).currentCredits ?? 0;

      // Step 3: Upload image to Cloudinary (non-blocking for generation success)
      let generatedImageUrl: string | null = null;
      if (imageUrl.startsWith('data:image')) {
        const uploadResult = await cloudinaryService.uploadImage(imageUrl, req.user!.uid);
        if (uploadResult) {
          generatedImageUrl = uploadResult.url;
        }
      }

      // Step 4: Store request data in Firestore for feedback analysis and history
      await storeUserRequestData({
        userId: req.user!.uid,
        email: req.user!.email,
        type: 'text-to-image',
        prompt: prompt,
        improvedPrompt: improvedPrompt,
        language: language,
        style: style || null,
        outfitMode: outfitMode || 'full',
        inputImageProvided: false,
        generationTimeMs: generationTime,
        generatedImageUrl: generatedImageUrl,
        success: true,
      });

      const response: GenerateImageResponse = {
        success: true,
        imageUrl: imageUrl,
        prompt: improvedPrompt,
        generationTime: generationTime,
        language: language,
        credits: newCredits,
      };

      console.log(`✅ Image generated in ${generationTime}ms (credits remaining: ${newCredits})`);
      res.json(response);
    } catch (error: any) {
      // Refund the reserved credit since generation failed
      await refundUserCredit(req.user!.uid);
      console.error('❌ Image generation failed (credit refunded):', error);
      throw new AppError(error.message || 'Failed to generate image', 500);
    }
  })
);

/**
 * POST /api/generate/from-image
 * Generate an image from a reference image + optional text prompt
 */
router.post(
  '/generate/from-image',
  authMiddleware,
  userCreditLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { imageData, textPrompt, style } = req.body;

    // Validation
    if (!imageData) {
      await refundUserCredit(req.user!.uid);
      throw new AppError('Image data is required', 400);
    }

    console.log(`🖼️ Image-to-image generation request from ${req.user?.email}:`, { 
      hasImage: !!imageData, 
      textPrompt: textPrompt || '(none)',
      style 
    });

    const startTime = Date.now();

    try {
      // Generate image using multimodal input (queued for concurrency control)
      console.log(`🎨 Generating from reference image (queue: ${geminiQueue.getStatus().queuedCount} waiting)...`);
      const imageUrl = await geminiQueue.enqueue(() =>
        geminiService.generateFromImage(imageData, textPrompt || '')
      );

      const generationTime = Date.now() - startTime;

      // Credits already deducted atomically in the middleware transaction
      const newCredits = (req as any).currentCredits ?? 0;

      // Upload image to Cloudinary (non-blocking for generation success)
      let generatedImageUrl: string | null = null;
      if (imageUrl.startsWith('data:image')) {
        const uploadResult = await cloudinaryService.uploadImage(imageUrl, req.user!.uid);
        if (uploadResult) {
          generatedImageUrl = uploadResult.url;
        }
      }

      // Store request data in Firestore for feedback analysis and history
      await storeUserRequestData({
        userId: req.user!.uid,
        email: req.user!.email,
        type: 'image-to-image',
        prompt: textPrompt || '',
        improvedPrompt: '',
        language: 'en',
        style: style || null,
        outfitMode: null,
        inputImageProvided: true,
        generationTimeMs: generationTime,
        generatedImageUrl: generatedImageUrl,
        success: true,
      });

      const response = {
        success: true,
        imageUrl: imageUrl,
        generationTime: generationTime,
        credits: newCredits,
      };

      console.log(`✅ Image generated from reference in ${generationTime}ms (credits remaining: ${newCredits})`);
      res.json(response);
    } catch (error: any) {
      // Refund the reserved credit since generation failed
      await refundUserCredit(req.user!.uid);
      console.error('❌ Image-to-image generation failed (credit refunded):', error);
      throw new AppError(error.message || 'Failed to generate image', 500);
    }
  })
);

/**
 * POST /api/speech-to-text
 * Convert audio to text
 */
router.post(
  '/speech-to-text',
  authMiddleware,
  speechLimiter,
  asyncHandler(async (req: Request<{}, {}, SpeechToTextRequest>, res: Response<SpeechToTextResponse>) => {
    const { audioData, languageCode } = req.body;

    // Validation
    if (!audioData) {
      throw new AppError('Audio data is required', 400);
    }

    if (!languageCode) {
      throw new AppError('Language code is required', 400);
    }

    console.log(`🎤 Speech-to-text request (Language: ${languageCode})`);

    // Check if Speech-to-Text service is available
    if (!speechToTextService.isAvailable()) {
      throw new AppError(
        'Speech-to-Text service is not configured. Please set up Google Cloud credentials.',
        503
      );
    }

    try {
      const { text, confidence } = await speechToTextService.convertAudioToText(
        audioData,
        languageCode
      );

      const response: SpeechToTextResponse = {
        success: true,
        text: text,
        language: languageCode,
        confidence: confidence,
      };

      console.log(`✅ Speech converted to text: "${text}"`);
      res.json(response);
    } catch (error: any) {
      console.error('❌ Speech-to-text conversion failed:', error);
      throw new AppError(error.message || 'Failed to convert speech to text', 500);
    }
  })
);

/**
 * GET /api/queue-status
 * Get the current Gemini request queue status
 */
router.get('/queue-status', (req: Request, res: Response) => {
  const status = geminiQueue.getStatus();
  res.json({
    success: true,
    ...status,
  });
});

/**
 * GET /api/user/credits
 * Get the current user's credit balance.
 * Also performs a lazy daily top-up: if ≥24 hours have passed since
 * lastCreditRefresh, awards up to dailyCreditIncrement credits (capped
 * at maxCreditsPerUser). If user already has ≥ max, no credits are
 * added but existing balance is NOT reduced.
 * Admin users (config.adminEmails) are exempt from the daily scheme.
 */
router.get(
  '/user/credits',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const uid = req.user!.uid;
    const email = (req.user!.email || '').toLowerCase();
    const isAdmin = config.adminEmails.map(e => e.toLowerCase()).includes(email);

    const usageRef = db.collection('userUsage').doc(uid);

    // Run inside a transaction so concurrent calls can't double-award
    const result = await db.runTransaction(async (transaction) => {
      const usageDoc = await transaction.get(usageRef);

      if (!usageDoc.exists) {
        // First-time user — create doc with 0 credits, no top-up yet
        const now = new Date().toISOString();
        let fallbackName = req.user!.displayName;
        if (!fallbackName) {
           try {
             // Fallback: if token is stale and missing name, fetch from Firebase Auth directly
             const fbUser = await admin.auth().getUser(uid);
             fallbackName = fbUser.displayName || '';
             // Ensure email is also updated if missing
             if (!req.user!.email && fbUser.email) req.user!.email = fbUser.email;
           } catch(e) {
             console.error('Failed to fetch user from Firebase admin during userUsage init:', e);
           }
        }
        
        transaction.set(usageRef, {
          credits: 0,
          totalGenerations: 0,
          email: req.user!.email || '',
          displayName: fallbackName || '',
          lastCreditRefresh: now,
          createdAt: now,
          approved: false,
        });
        return {
          credits: 0,
          totalGenerations: 0,
          creditTopUp: null, // first visit, no top-up
          approved: false,
        };
      }

      const data = usageDoc.data()!;
      let credits = data.credits ?? 0;
      const totalGenerations = data.totalGenerations ?? 0;

      // Ensure email and displayName are stored/updated
      const updates: Record<string, any> = {};
      if (!data.email) updates.email = req.user!.email || '';
      if (!data.displayName) updates.displayName = req.user!.displayName || '';

      // --- Daily credit top-up (skip for admins and unapproved users) ---
      let creditTopUp: { awarded: number; capped: boolean; newBalance: number } | null = null;
      const userApproved = data.approved === true;

      if (!isAdmin && userApproved) {
        const lastRefresh = data.lastCreditRefresh
          ? new Date(data.lastCreditRefresh).getTime()
          : 0;
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;

        if (now - lastRefresh >= twentyFourHours) {
          // Eligible for daily top-up
          if (credits >= config.maxCreditsPerUser) {
            // Already at or above cap — don't add, don't reduce
            creditTopUp = { awarded: 0, capped: true, newBalance: credits };
          } else {
            // Add credits, but cap at maxCreditsPerUser
            const maxCanAdd = config.maxCreditsPerUser - credits;
            const awarded = Math.min(config.dailyCreditIncrement, maxCanAdd);
            credits += awarded;
            updates.credits = credits;
            creditTopUp = { awarded, capped: awarded < config.dailyCreditIncrement, newBalance: credits };
          }
          updates.lastCreditRefresh = new Date().toISOString();
        }
      }

      if (Object.keys(updates).length > 0) {
        transaction.update(usageRef, updates);
      }

      return { credits, totalGenerations, creditTopUp, approved: userApproved };
    });

    res.json({
      success: true,
      credits: result.credits,
      totalGenerations: result.totalGenerations,
      creditTopUp: result.creditTopUp,
      approved: result.approved,
    });
  })
);

/**
 * POST /api/user/request-credits
 * Submit a request for more credits (admin reviews manually)
 */
router.post(
  '/user/request-credits',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const uid = req.user!.uid;
    const email = req.user!.email;
    const { message, requestedCredits } = req.body;
    
    // Parse to ensure it's a number, default to 0 if not provided
    const parsedCredits = parseInt(requestedCredits as any) || 0;

    await db.collection('creditRequests').add({
      userId: uid,
      email: email,
      message: message || 'Requesting more credits',
      requestedCredits: parsedCredits,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`📩 Credit request from ${email} (${uid})`);

    res.json({
      success: true,
      message: 'Your credit request has been submitted. An admin will review it shortly.',
    });
  })
);

/**
 * GET /api/user/credit-requests
 * Fetch the authenticated user's credit request history and total credits used.
 */
router.get(
  '/user/credit-requests',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const uid = req.user!.uid;

    // Fetch user's credit requests (remove orderBy to avoid needing a composite index)
    const snap = await db
      .collection('creditRequests')
      .where('userId', '==', uid)
      .get();

    const requests = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        message: data.message,
        requestedCredits: data.requestedCredits || 0,
        approvedCredits: data.approvedCredits,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Sort in-memory by createdAt descending
    requests.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    // Fetch total credits used (totalGenerations) from userUsage
    const usageDoc = await db.collection('userUsage').doc(uid).get();
    let totalCreditsUsed = 0;
    if (usageDoc.exists) {
      const data = usageDoc.data();
      totalCreditsUsed = parseInt(data?.totalGenerations as any) || 0;
    }

    res.json({ 
      success: true, 
      requests, 
      totalCreditsUsed 
    });
  })
);

/**
 * GET /api/user/generation-history
 * Fetch the authenticated user's generation history.
 */
router.get(
  '/user/generation-history',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const uid = req.user!.uid;
    const cursor = req.query.cursor as string | undefined;

    let query = db
      .collection('userRequests')
      .where('userId', '==', uid)
      .where('success', '==', true)
      .orderBy('timestamp', 'desc')
      .limit(10);

    if (cursor) {
      const cursorDoc = await db.collection('userRequests').doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();

    // Fetch total generations for the UI
    let totalGenerations = 0;
    const usageDoc = await db.collection('userUsage').doc(uid).get();
    if (usageDoc.exists) {
      const data = usageDoc.data();
      totalGenerations = parseInt(data?.totalGenerations as any) || 0;
    }

    const history = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        type: data.type,
        prompt: data.prompt,
        improvedPrompt: data.improvedPrompt,
        language: data.language,
        style: data.style,
        outfitMode: data.outfitMode,
        generatedImageUrl: data.generatedImageUrl,
        generationTimeMs: data.generationTimeMs,
        timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ 
      success: true, 
      history,
      totalGenerations
    });
  })
);

export default router;