import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env';

class GeminiService {
  private genAI: GoogleGenAI;
  private textModel: any;

  constructor() {
    // New SDK for image generation
    this.genAI = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });

    // Old SDK for text generation (prompt improvement, translation)
    const oldGenAI = new GoogleGenerativeAI(config.geminiApiKey);
    this.textModel = oldGenAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  /**
   * Generate an image based on text prompt using Gemini's native image generation
   */
  async generateImage(prompt: string, language: string): Promise<string> {
  try {
    console.log(`🎨 Generating image for prompt: "${prompt}" (Language: ${language})`);

    // Enhance the prompt (now removes human references)
    const enhancedPrompt = this.enhancePrompt(prompt, language);
    console.log(`✨ Enhanced prompt: "${enhancedPrompt}"`);

    // Generate image using Gemini 2.5 Flash Image model
    const response = await this.genAI.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: enhancedPrompt,
    });

    // Debug logging
    console.log('📦 Response received');
    console.log('📊 Candidates:', response.candidates?.length || 0);

    // Extract image data
    let imageData: string | null = null;

    if (!response.candidates || response.candidates.length === 0) {
      console.error('❌ No candidates in response');
      throw new Error('No candidates in response');
    }

    const candidate = response.candidates[0];
    
    if (!candidate.content?.parts) {
      console.error('❌ No content parts in response');
      throw new Error('Invalid response structure');
    }

    console.log(`🔍 Checking ${candidate.content.parts.length} parts for image data`);

    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        console.log(`✅ Found image data (${imageData.length} bytes)`);
        break;
      }
      
      if (part.text) {
        console.log(`ℹ️  Found text part: ${part.text.substring(0, 100)}...`);
      }
    }

    if (!imageData) {
      console.error('❌ No image data in response parts');
      console.error('Available parts:', candidate.content.parts.map(p => Object.keys(p)));
      throw new Error('No image data in response');
    }

    console.log(`✅ Image generated successfully`);

    return `data:image/png;base64,${imageData}`;
  } catch (error) {
    console.error('❌ Error generating image:', error);
    console.log('⚠️  Falling back to mock image');
    return this.generateMockImage(prompt);
  }
}

  /**
   * Enhance the prompt with fashion-specific context
   */
  private enhancePrompt(prompt: string, language: string): string {
    
    const negativePrompt = 'no text, no watermark, no labels, no words, no letters, no writing';
  
  const fashionContext = 
    'High-quality fashion photography, professional studio lighting, detailed fabric texture, ' +
    'vibrant colors, elegant styling, fashion magazine quality, 8K resolution, ' +
    negativePrompt + ', '; // Add negative prompt here
    
    // const fashionContext = 
    //   'High-quality fashion photography, professional studio lighting, detailed fabric texture, ' +
    //   'vibrant colors, elegant styling, fashion magazine quality, 8K resolution, ';

    // Add Indian fashion context if applicable
    const indianFashionKeywords = [
      'saree', 'sari', 'lehenga', 'kurta', 'salwar', 'kameez', 
      'sherwani', 'anarkali', 'dhoti', 'churidar', 'dupatta',
      'bridal', 'wedding', 'ethnic', 'traditional'
    ];
    
    const isIndianFashion = indianFashionKeywords.some(keyword => 
      prompt.toLowerCase().includes(keyword)
    );

    if (isIndianFashion) {
      return fashionContext + 
        'traditional Indian fashion design, intricate embroidery, rich embellishments, ' +
        'cultural authenticity, gold zari work, ' + 
        prompt;
    }

    return fashionContext + prompt;
  }

  /**
   * Generate an image from a reference image + optional text prompt (multimodal)
   */
  async generateFromImage(imageData: string, textPrompt: string): Promise<string> {
    try {
      console.log(`🖼️ Generating from reference image with prompt: "${textPrompt || '(no text)'}"`);

      // Extract base64 data if it's a data URL
      let base64Data = imageData;
      let mimeType = 'image/png';
      
      if (imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:(.+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          base64Data = matches[2];
        }
      }

      // Create the multimodal prompt
      const fashionPrompt = textPrompt 
        ? `Based on this reference fashion image, create a new fashion design with the following modifications: ${textPrompt}. High-quality fashion photography, professional studio lighting, detailed fabric texture, vibrant colors, elegant styling, fashion magazine quality, no text, no watermark.`
        : `Analyze this fashion garment and create a new, inspired fashion design based on its style elements. High-quality fashion photography, professional studio lighting, detailed fabric texture, vibrant colors, elegant styling, fashion magazine quality, no text, no watermark.`;

      // Generate using Gemini multimodal
      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data,
                }
              },
              {
                text: fashionPrompt
              }
            ]
          }
        ],
      });

      // Extract image data from response
      let outputImageData: string | null = null;

      if (!response.candidates || response.candidates.length === 0) {
        throw new Error('No candidates in response');
      }

      const candidate = response.candidates[0];
      
      if (!candidate.content?.parts) {
        throw new Error('Invalid response structure');
      }

      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          outputImageData = part.inlineData.data;
          console.log(`✅ Found generated image data (${outputImageData.length} bytes)`);
          break;
        }
      }

      if (!outputImageData) {
        throw new Error('No image data in response');
      }

      console.log(`✅ Image-to-image generation complete`);

      return `data:image/png;base64,${outputImageData}`;
    } catch (error) {
      console.error('❌ Error in image-to-image generation:', error);
      throw error;
    }
  }

  /**
   * Generate a mock image URL (fallback)
   */
  private generateMockImage(prompt: string): string {
    const seed = Math.floor(Math.random() * 1000);
    return `https://source.unsplash.com/800x800/?fashion,clothing,${seed}`;
  }

  /**
   * Translate text using Gemini (if needed)
   */
  async translateToEnglish(text: string, sourceLanguage: string): Promise<string> {
    try {
      if (sourceLanguage === 'en' || sourceLanguage === 'en-US' || sourceLanguage === 'en-IN') {
        return text;
      }

      const translationPrompt = `Translate the following ${sourceLanguage} text to English. Only return the translation, nothing else:\n\n${text}`;
      
      const result = await this.textModel.generateContent(translationPrompt);
      const response = await result.response;
      const translation = response.text();

      console.log(`🌐 Translated: "${text}" → "${translation}"`);
      return translation.trim();
    } catch (error) {
      console.error('❌ Translation error:', error);
      return text; // Return original if translation fails
    }
  }

  /**
   * Improve prompt quality using Gemini with mode-specific structure preservation
   * and built-in multilingual support (translates non-English text inline).
   */
  async improvePrompt(userPrompt: string, outfitMode: 'full' | 'custom' = 'full'): Promise<string> {
    try {
      const commonRules = `
CRITICAL RULES (apply to ALL modes):
1. MULTILINGUAL: The input may contain text in Hindi, Marathi, Tamil, Telugu, Punjabi, Bengali, or other Indian languages. You MUST understand it, translate it to English, and incorporate its meaning naturally into the enhanced prompt. Do NOT drop or ignore non-English text.
2. ENHANCE DESCRIPTIONS: Add details about lighting, fabric texture, fold drapery, color depth, and atmosphere to make the prompt more vivid. Keep it concise and apt.
3. NO HALLUCINATIONS: Do not add items (like hats, glasses, jewelry) unless implied by the style or explicitly requested.
4. BE CONCISE: Do not add conversational filler ("Here is an improved prompt..."). Just return the prompt directly.
5. PRESERVE NEGATIVE CONSTRAINTS: If the user says "DO NOT generate...", "Crop out...", or "Focus camera on...", you MUST include these instructions exactly as they are. Do not rephrase or remove them.
6. PRESERVE ALL DETAILS: If garment, fabric, print type, color, or any other selection detail has been specified, make sure you emphasize it in the enhanced prompt.`;

      let modeSpecificRules = '';

      if (outfitMode === 'full') {
        modeSpecificRules = `
MODE: FULL OUTFIT
You are enhancing a structured fashion prompt for a FULL OUTFIT (single garment covering the whole body, like a saree, lehenga, dress, or sherwani).

STRUCTURE PRESERVATION — You MUST preserve these structural markers as labeled sections in your output:
- "Gender:" — Keep the gender context exactly as specified
- "Model:" — Keep the model/person type description
- "Body type:" — Keep the body type description
- "Pose:" — Keep the pose/posture description
- "Color:" — Keep the color specification
- "OUTFIT:" / "Garment:" / "Fabric:" / "Pattern:" — Keep these garment specification sections
- "Design preference:" — Keep design style preferences

Your output must maintain these as clearly labeled sections. Within each section, enhance the description with vivid fashion photography details. Do NOT merge all sections into a single prose paragraph.`;
      } else {
        modeSpecificRules = `
MODE: CUSTOM (UPPER + LOWER BODY)
You are enhancing a structured fashion prompt where the upper body and lower body have SEPARATE styling.

STRUCTURE PRESERVATION — You MUST preserve these structural markers as labeled sections in your output:
- "Gender:" — Keep the gender context exactly as specified
- "Model:" — Keep the model/person type description
- "Body type:" — Keep the body type description
- "Pose:" — Keep the pose/posture description
- "UPPER BODY ONLY (from shoulders to waist):" — Keep this section separate with its own styling
- "LOWER BODY ONLY (from waist to feet):" — Keep this section separate with its own styling
- "FOOTWEAR:" — Keep footwear as its own section
- "HEADWEAR:" — Keep headwear as its own section
- "ACCESSORY (...):" — Keep each accessory section separate
- "IMPORTANT:" — Preserve any cross-section constraint instructions exactly

Your output must maintain these as clearly labeled sections. Within each section, enhance the description with vivid fashion photography details. Do NOT merge upper and lower body descriptions. Do NOT mix styles between sections.`;
      }

      const systemInstruction = `You are an expert AI prompt engineer for a high-end fashion image generator.
Your goal is to enhance the descriptive quality of the user's prompt WITHOUT changing the structural constraints or meaning.
${commonRules}
${modeSpecificRules}`;

      const finalPrompt = `${systemInstruction}\n\nInput Prompt:\n"${userPrompt}"\n\nProvide the Improved Prompt:`;

      const result = await this.textModel.generateContent(finalPrompt);
      const response = await result.response;
      const improvedPrompt = response.text();

      console.log(`✨ Improved prompt (${outfitMode} mode): "${improvedPrompt.trim()}"`);
      return improvedPrompt.trim();
    } catch (error) {
      console.error('❌ Prompt improvement error:', error);
      return userPrompt; // Return original if improvement fails
    }
  }
}

export default new GeminiService();