import request from 'supertest';
import app from '../server';

// Mock the Firebase Admin initialization so tests don't throw connection issues
jest.mock('firebase-admin', () => {
  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: {
      cert: jest.fn(),
    },
    auth: jest.fn(() => ({})),
    firestore: () => ({
      collection: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true }),
      })),
    }),
  };
});

// Mock Cloudinary config
jest.mock('cloudinary', () => {
  return {
    v2: {
      config: jest.fn(),
      uploader: {
        upload: jest.fn().mockResolvedValue({ secure_url: 'http://example.com/mock.jpg' }),
      },
    },
  };
});

describe('RoopVana API Server', () => {
  
  it('GET / should return server info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'running');
    expect(res.body).toHaveProperty('message', 'RoopVana API Server');
  });

  it('GET /api/health should return ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /api/languages should return supported languages', async () => {
    const res = await request(app).get('/api/languages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('languages');
    expect(Array.isArray(res.body.languages)).toBe(true);
  });

  it('POST /api/generate without auth should return 401', async () => {
    const res = await request(app).post('/api/generate').send({});
    // Expected to fail authentication first
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
  });
  
  it('POST /api/speech-to-text without auth should return 401', async () => {
    const res = await request(app).post('/api/speech-to-text').send({});
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
  });

});
