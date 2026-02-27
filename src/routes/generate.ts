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
import { speechLimiter, userCreditLimiter, deductUserCredit } from '../middleware/rateLimiter';
import { authMiddleware } from '../middleware/authMiddleware';
import { db } from '../config/firebaseAdmin';
import admin from '../config/firebaseAdmin';

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
  inputImageProvided: boolean;
  generationTimeMs: number;
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
    const { prompt, language, style } = req.body;

    // Validation
    if (!prompt || !prompt.trim()) {
      throw new AppError('Prompt is required', 400);
    }

    if (!language) {
      throw new AppError('Language is required', 400);
    }

    console.log(`📝 Image generation request from ${req.user?.email}:`, { prompt, language, style });

    const startTime = Date.now();

    try {
      // Step 1: Translate prompt to English if needed
      let englishPrompt = prompt;
      if (language !== 'en' && language !== 'en-US' && language !== 'en-IN') {
        console.log(`🌐 Translating prompt from ${language} to English...`);
        englishPrompt = await geminiService.translateToEnglish(prompt, language);
      }

      // Step 2: Improve prompt for better image generation
      console.log(`✨ Improving prompt...`);
      const improvedPrompt = await geminiService.improvePrompt(englishPrompt);

      // Step 3: Generate image
      console.log(`🎨 Generating image...`);
      const imageUrl = await geminiService.generateImage(improvedPrompt, language);

      const generationTime = Date.now() - startTime;

      // Step 4: Deduct 1 credit
      const newCredits = await deductUserCredit(req.user!.uid);

      // Step 5: Store request data in Firestore for feedback analysis
      await storeUserRequestData({
        userId: req.user!.uid,
        email: req.user!.email,
        type: 'text-to-image',
        prompt: prompt,
        improvedPrompt: improvedPrompt,
        language: language,
        style: style || null,
        inputImageProvided: false,
        generationTimeMs: generationTime,
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
      console.error('❌ Image generation failed:', error);
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
      throw new AppError('Image data is required', 400);
    }

    console.log(`🖼️ Image-to-image generation request from ${req.user?.email}:`, { 
      hasImage: !!imageData, 
      textPrompt: textPrompt || '(none)',
      style 
    });

    const startTime = Date.now();

    try {
      // Generate image using multimodal input
      console.log(`🎨 Generating from reference image...`);
      const imageUrl = await geminiService.generateFromImage(imageData, textPrompt || '');

      const generationTime = Date.now() - startTime;

      // Deduct 1 credit
      const newCredits = await deductUserCredit(req.user!.uid);

      // Store request data in Firestore for feedback analysis
      await storeUserRequestData({
        userId: req.user!.uid,
        email: req.user!.email,
        type: 'image-to-image',
        prompt: textPrompt || '',
        improvedPrompt: '',
        language: 'en',
        style: style || null,
        inputImageProvided: true,
        generationTimeMs: generationTime,
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
      console.error('❌ Image-to-image generation failed:', error);
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
 * GET /api/user/credits
 * Get the current user's credit balance
 */
router.get(
  '/user/credits',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const uid = req.user!.uid;
    const usageRef = db.collection('userUsage').doc(uid);
    const usageDoc = await usageRef.get();

    let credits = 0;
    let totalGenerations = 0;

    if (usageDoc.exists) {
      const data = usageDoc.data()!;
      credits = data.credits ?? 0;
      totalGenerations = data.totalGenerations ?? 0;
      // Ensure email and displayName are stored/updated for admin searchability
      const updates: Record<string, string> = {};
      if (!data.email) updates.email = req.user!.email || '';
      if (!data.displayName) updates.displayName = req.user!.displayName || '';
      if (Object.keys(updates).length > 0) {
        await usageRef.update(updates);
      }
    } else {
      // First-time: create doc with 0 credits
      await usageRef.set({
        credits: 0,
        totalGenerations: 0,
        email: req.user!.email || '',
        displayName: req.user!.displayName || '',
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      credits,
      totalGenerations,
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
    const { message } = req.body;

    await db.collection('creditRequests').add({
      userId: uid,
      email: email,
      message: message || 'Requesting more credits',
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

export default router;