import { v2 as cloudinary } from 'cloudinary';
import config from '../config/env';

// Configure Cloudinary
if (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
  });
}

class CloudinaryService {
  /**
   * Uploads a base64 image data URL to Cloudinary
   * @param base64DataUrl The base64 image (e.g., 'data:image/png;base64,...')
   * @param userId The user's ID for organizing into folders
   * @returns The secure CDN URL and public ID
   */
  async uploadImage(base64DataUrl: string, userId: string): Promise<{ url: string; publicId: string } | null> {
    try {
      if (!config.cloudinaryCloudName) {
        console.warn('⚠️ Cloudinary not configured. Skipping image upload.');
        return null;
      }

      console.log(`☁️ Uploading image to Cloudinary for user ${userId}...`);

      const result = await cloudinary.uploader.upload(base64DataUrl, {
        folder: `roopvana/${userId}`,
        resource_type: 'image',
      });

      console.log(`✅ Image uploaded to Cloudinary: ${result.secure_url}`);

      return {
        url: result.secure_url,
        publicId: result.public_id,
      };
    } catch (error: any) {
      console.error('❌ Error uploading to Cloudinary:', error.message || error);
      // We don't throw here so that the main generation flow doesn't break if upload fails
      return null;
    }
  }
}

export default new CloudinaryService();
