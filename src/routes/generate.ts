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
import { generateLimiter, speechLimiter } from '../middleware/rateLimiter';

const router = Router();

/**
 * POST /api/generate
 * Generate an image from text prompt
 */
router.post(
  '/generate',
  generateLimiter,
  asyncHandler(async (req: Request<{}, {}, GenerateImageRequest>, res: Response<GenerateImageResponse>) => {
    const { prompt, language, style } = req.body;

    // Validation
    if (!prompt || !prompt.trim()) {
      throw new AppError('Prompt is required', 400);
    }

    if (!language) {
      throw new AppError('Language is required', 400);
    }

    console.log(`📝 Image generation request:`, { prompt, language, style });

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

      const response: GenerateImageResponse = {
        success: true,
        imageUrl: imageUrl,
        prompt: improvedPrompt,
        generationTime: generationTime,
        language: language,
      };

      console.log(`✅ Image generated in ${generationTime}ms`);
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
  generateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { imageData, textPrompt, style } = req.body;

    // Validation
    if (!imageData) {
      throw new AppError('Image data is required', 400);
    }

    console.log(`🖼️ Image-to-image generation request:`, { 
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

      const response = {
        success: true,
        imageUrl: imageUrl,
        generationTime: generationTime,
      };

      console.log(`✅ Image generated from reference in ${generationTime}ms`);
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

export default router;