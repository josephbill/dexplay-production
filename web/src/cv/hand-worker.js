// web/src/cv/hand-worker.js

// --- POLYFILL START ---
// Fixes "ModuleFactory not set" in Vite module workers.
if (typeof self !== "undefined" && !("import" in self)) {
  self.import = async (url) => {
    const response = await fetch(url);
    let text = await response.text();

    // Patch sloppy-mode issues for strict ESM context
    text = text.replace(
      /if\s*\(\s*typeof\s*\(?\s*custom_dbg\s*\)?\s*===?\s*"undefined"\s*\)\s*\{\s*function\s*custom_dbg\s*\(\s*text\s*\)\s*\{/,
      "var custom_dbg; if (typeof custom_dbg === 'undefined') { custom_dbg = function(text) {"
    );

    // Expose ModuleFactory to the global scope
    text += "\nself.ModuleFactory = ModuleFactory;\n";

    const blob = new Blob([text], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await import(/* @vite-ignore */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  };
}
// --- POLYFILL END ---

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let landmarker = null;

self.onmessage = async (event) => {
  const { type, imageBitmap, timestamp } = event.data;

  if (type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      
      // Attempt GPU first
      try {
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      } catch (gpuErr) {
        // Fallback to CPU if GPU fails (common on older mobile chips or inside workers)
        console.warn('[HandWorker] GPU delegate failed, falling back to CPU', gpuErr);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }

      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (type === 'detect' && landmarker && imageBitmap) {
    try {
      const results = landmarker.detectForVideo(imageBitmap, timestamp);
      self.postMessage({ type: 'result', results, timestamp });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    } finally {
      imageBitmap.close(); // Free memory
    }
  }
};