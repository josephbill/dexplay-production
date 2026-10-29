// web/src/cv/hand-worker.js
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let landmarker = null;

self.onmessage = async (event) => {
  const { type, imageBitmap, timestamp } = event.data;

  if (type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'GPU', // Try GPU first; if it fails, fall back below
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      // GPU delegate can fail on some devices; fall back to CPU
      try {
        const vision = await FilesetResolver.forVisionTasks('/wasm');
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        self.postMessage({ type: 'ready', delegate: 'CPU' });
      } catch (err2) {
        self.postMessage({ type: 'error', message: err2.message });
      }
    }
    return;
  }

  if (type === 'detect' && landmarker && imageBitmap) {
    try {
      // MediaPipe accepts ImageBitmap as a valid image source
      const results = landmarker.detectForVideo(imageBitmap, timestamp);
      self.postMessage({ type: 'result', results, timestamp });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    } finally {
      // Important: free the bitmap to avoid memory leaks
      imageBitmap.close();
    }
  }
};