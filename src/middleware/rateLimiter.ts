import rateLimit from 'express-rate-limit';
import config from '../config/env';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs, // 1 minute default
  max: config.rateLimitMaxRequests, // 10 requests per minute default
  message: {
    success: false,
    error: 'Too Many Requests',
    message: 'Too many requests from this IP, please try again later.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for image generation (expensive operation)
export const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: {
    success: false,
    error: 'Too Many Requests',
    message: 'Image generation limit exceeded. Please wait before generating more images.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for speech-to-text
export const speechLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    error: 'Too Many Requests',
    message: 'Speech-to-text limit exceeded. Please wait before trying again.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});