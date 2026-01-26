import { SpeechClient } from '@google-cloud/speech';
import type { protos } from '@google-cloud/speech';
import config from '../config/env';

class SpeechToTextService {
  private client?: SpeechClient;

  constructor() {
    // Initialize Speech-to-Text client
    // Will use GOOGLE_APPLICATION_CREDENTIALS env variable
    try {
      this.client = new SpeechClient({
        keyFilename: config.googleApplicationCredentials || undefined,
      });
      console.log('✅ Speech-to-Text client initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Speech-to-Text client:', error);
      console.log('ℹ️  Speech-to-Text features will be disabled');
      this.client = undefined;
    }
  }

  /**
   * Convert audio to text
   * @param audioData Base64 encoded audio data
   * @param languageCode Language code (e.g., 'hi-IN', 'ta-IN')
   */
  async convertAudioToText(
    audioData: string,
    languageCode: string = 'hi-IN'
  ): Promise<{ text: string; confidence: number }> {
    try {
      if (!this.client) {
        throw new Error('Speech-to-Text client not initialized');
      }

      console.log(`🎤 Converting audio to text (Language: ${languageCode})`);

      // Remove data URL prefix if present
      const base64Audio = audioData.replace(/^data:audio\/\w+;base64,/, '');

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(base64Audio, 'base64');

      const audio = {
        content: audioBuffer.toString('base64'),
      };

      const config = {
        encoding: 'WEBM_OPUS' as const, // Most browsers use WebM Opus for audio recording
        sampleRateHertz: 48000,
        languageCode: languageCode,
        alternativeLanguageCodes: ['en-IN', 'en-US'], // Fallback languages
        enableAutomaticPunctuation: true,
        model: 'default',
      };

      const request = {
        audio: audio,
        config: config,
      };

      // Perform the transcription
      const [response] = await this.client.recognize(request);

      if (!response.results || response.results.length === 0) {
        throw new Error('No transcription results');
      }

      const transcription = response.results
        .map((result: protos.google.cloud.speech.v1.ISpeechRecognitionResult) => result.alternatives?.[0]?.transcript || '')
        .join('\n');

      const confidence = response.results[0]?.alternatives?.[0]?.confidence || 0;

      console.log(`✅ Transcription: "${transcription}" (Confidence: ${confidence.toFixed(2)})`);

      return {
        text: transcription,
        confidence: confidence,
      };
    } catch (error) {
      console.error('❌ Speech-to-Text error:', error);
      throw new Error('Failed to convert audio to text');
    }
  }

  /**
   * Convert audio stream to text (for real-time transcription)
   */
  async convertAudioStreamToText(
    audioStream: NodeJS.ReadableStream,
    languageCode: string = 'hi-IN'
  ): Promise<string> {
    try {
      if (!this.client) {
        throw new Error('Speech-to-Text client not initialized');
      }

      console.log(`🎤 Starting streaming transcription (Language: ${languageCode})`);

      const recognizeStream = this.client
        .streamingRecognize({
          config: {
            encoding: 'LINEAR16' as const,
            sampleRateHertz: 16000,
            languageCode: languageCode,
            enableAutomaticPunctuation: true,
          },
          interimResults: false,
        });

      return new Promise((resolve, reject) => {
        let transcription = '';

        recognizeStream
          .on('error', (error: Error) => {
            console.error('❌ Streaming error:', error);
            reject(error);
          })
          .on('data', (data: protos.google.cloud.speech.v1.IStreamingRecognizeResponse) => {
            const result = data.results?.[0];
            if (result && result.alternatives && result.alternatives[0]) {
              transcription += result.alternatives[0].transcript + ' ';
            }
          })
          .on('end', () => {
            console.log(`✅ Streaming transcription complete: "${transcription}"`);
            resolve(transcription.trim());
          });

        audioStream.pipe(recognizeStream);
      });
    } catch (error) {
      console.error('❌ Streaming Speech-to-Text error:', error);
      throw new Error('Failed to convert audio stream to text');
    }
  }

  /**
   * Check if Speech-to-Text service is available
   */
  isAvailable(): boolean {
    return !!this.client;
  }
}

export default new SpeechToTextService();