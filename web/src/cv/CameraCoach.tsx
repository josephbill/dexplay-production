// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
function inside(point, polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
        const crosses = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi + 1e-9) + xi);
        if (crosses)
            hit = !hit;
    }
    return hit;
}
async function openCv() {
    const imported = await import('@techstark/opencv-js');
    let cv = imported.default ?? imported;
    if (cv instanceof Promise)
        cv = await cv;
    if (cv?.Mat)
        return cv;
    await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('OpenCV initialization timed out')), 12000);
        cv.onRuntimeInitialized = () => { window.clearTimeout(timeout); resolve(); };
        cv.onAbort = (reason) => { window.clearTimeout(timeout); reject(new Error(String(reason))); };
    });
    if (!cv?.Mat)
        throw new Error('OpenCV WASM did not initialize');
    return cv;
}
export function CameraCoach({ active, clinic, dict, calibration, deviceId, onCorner, onFrame, onCameraReady }) {
    const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null);
    const calibrationRef = useRef(calibration);
    calibrationRef.current = calibration;
    const callbackRef = useRef(onFrame);
    callbackRef.current = onFrame;
    const readyCallbackRef = useRef(onCameraReady);
    readyCallbackRef.current = onCameraReady;
    const [error, setError] = useState(''), [ready, setReady] = useState(false), [cvReady, setCvReady] = useState(false), [corners, setCorners] = useState(calibration);
    const [fps, setFps] = useState(0), [frame, setFrame] = useState({ objects: [], hand_present: false, ts: 0 });
    const activeRef = useRef(active);
    activeRef.current = active;
    const tapCorner = useCallback((event) => {
        if (corners.length >= 4)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
        const next = [...corners, point];
        setCorners(next);
        onCorner(next);
    }, [corners, onCorner]);
    useEffect(() => {
        if (!active)
            return;
        let stopped = false, timer = 0, fpsFrames = 0, fpsStart = performance.now(), balance = null, cv;
        const width = clinic && window.innerWidth > 850 ? 640 : 320;
        const height = clinic && window.innerWidth > 850 ? 480 : 240;
        const start = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia)
                    throw new Error('camera-unavailable');
                const videoConstraints = { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: clinic ? 30 : 15, max: clinic ? 30 : 15 } };
                const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
                if (stopped) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                streamRef.current = stream;
                readyCallbackRef.current?.(stream.getVideoTracks()[0]?.getSettings() ?? {});
                const video = videoRef.current, canvas = canvasRef.current;
                video.srcObject = stream;
                await video.play();
                canvas.width = width;
                canvas.height = height;
                setReady(true);
                cv = await openCv();
                if (stopped)
                    return;
                setCvReady(true);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                let lastProcess = 0;
                const process = (now) => {
                    if (stopped || !activeRef.current)
                        return;
                    const wait = clinic ? 33 : 66;
                    if (now - lastProcess >= wait && video.readyState >= 2) {
                        lastProcess = now;
                        ctx.drawImage(video, 0, 0, width, height);
                        const pixels = ctx.getImageData(0, 0, width, height), data = pixels.data;
                        if (!balance) {
                            let r = 0, g = 0, b = 0, n = 0;
                            for (let i = 0; i < data.length; i += 16) {
                                r += data[i];
                                g += data[i + 1];
                                b += data[i + 2];
                                n++;
                            }
                            const mean = (r + g + b) / (3 * n);
                            balance = { r: Math.min(1.35, Math.max(.72, mean / (r / n || mean))), g: Math.min(1.35, Math.max(.72, mean / (g / n || mean))), b: Math.min(1.35, Math.max(.72, mean / (b / n || mean))) };
                            setCvReady(true);
                        }
                        for (let i = 0; i < data.length; i += 4) {
                            data[i] = Math.min(255, data[i] * balance.r);
                            data[i + 1] = Math.min(255, data[i + 1] * balance.g);
                            data[i + 2] = Math.min(255, data[i + 2] * balance.b);
                        }
                        ctx.putImageData(pixels, 0, 0);
                        const src = cv.imread(canvas), hsv = new cv.Mat(), objects = [];
                        try {
                            cv.cvtColor(src, hsv, cv.COLOR_RGBA2HSV);
                            const ranges = [
                                { color: 'red', lo: [[0, 90, 65], [170, 90, 65]], hi: [[12, 255, 255], [180, 255, 255]] },
                                { color: 'blue', lo: [[92, 70, 50]], hi: [[132, 255, 255]] },
                                { color: 'green', lo: [[36, 60, 45]], hi: [[87, 255, 255]] },
                                { color: 'yellow', lo: [[18, 75, 70]], hi: [[38, 255, 255]] },
                            ];
                            for (const range of ranges) {
                                const mask = new cv.Mat();
                                try {
                                    for (let band = 0; band < range.lo.length; band++) {
                                        const part = new cv.Mat(), low = new cv.Scalar(...range.lo[band], 0), high = new cv.Scalar(...range.hi[band], 0);
                                        cv.inRange(hsv, low, high, part);
                                        cv.bitwise_or(mask, part, mask);
                                        part.delete();
                                    }
                                    const contours = new cv.MatVector(), hierarchy = new cv.Mat();
                                    try {
                                        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                                        for (let i = 0; i < contours.size() && objects.length < 32; i++) {
                                            const contour = contours.get(i);
                                            try {
                                                const area = cv.contourArea(contour);
                                                if (area < 28 || area > width * height * .12)
                                                    continue;
                                                const moments = cv.moments(contour);
                                                if (!moments.m00)
                                                    continue;
                                                const cx = moments.m10 / moments.m00 / width, cy = moments.m01 / moments.m00 / height;
                                                let zone_id = null;
                                                if (calibrationRef.current.length === 4 && inside([cx, cy], calibrationRef.current)) {
                                                    const [leftTop, rightTop, rightBottom, leftBottom] = calibrationRef.current;
                                                    const middleX = (leftTop[0] + rightTop[0] + rightBottom[0] + leftBottom[0]) / 4;
                                                    const middleY = (leftTop[1] + rightTop[1] + rightBottom[1] + leftBottom[1]) / 4;
                                                    zone_id = cy < middleY ? (cx < middleX ? 'red' : 'blue') : (cx < middleX ? 'green' : 'yellow');
                                                }
                                                objects.push({ color: range.color, cx, cy, zone_id, area });
                                            }
                                            finally {
                                                contour.delete();
                                            }
                                        }
                                    }
                                    finally {
                                        contours.delete();
                                        hierarchy.delete();
                                    }
                                }
                                finally {
                                    mask.delete();
                                }
                            }
                            // A large skin-tone region is a lightweight hand-present signal; no image is retained.
                            const skin = new cv.Mat(), skinLow = new cv.Scalar(0, 25, 55, 0), skinHigh = new cv.Scalar(25, 190, 255, 0);
                            let handPresent = false;
                            try {
                                cv.inRange(hsv, skinLow, skinHigh, skin);
                                handPresent = cv.countNonZero(skin) > width * height * .025;
                            }
                            finally {
                                skin.delete();
                            }
                            const result = { objects, hand_present: handPresent, ts: Date.now() };
                            setFrame(result);
                            callbackRef.current(result);
                        }
                        finally {
                            src.delete();
                            hsv.delete();
                        }
                        fpsFrames++;
                        if (now - fpsStart >= 1000) {
                            setFps(Math.round(fpsFrames * 1000 / (now - fpsStart)));
                            fpsFrames = 0;
                            fpsStart = now;
                        }
                    }
                    timer = window.requestAnimationFrame(process);
                };
                timer = window.requestAnimationFrame(process);
            }
            catch (err) {
                if (!stopped) {
                    setError(err instanceof Error && err.message === 'camera-unavailable' ? t(dict, 'camera_error') : t(dict, 'camera_denied'));
                    setReady(false);
                }
            }
        };
        void start();
        return () => { stopped = true; window.cancelAnimationFrame(timer); streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setReady(false); setCvReady(false); setFps(0); };
    }, [active, clinic, dict, deviceId]);
    return <section className="camera-card" aria-label={t(dict, 'camera')}>
    <div className="camera-frame" onPointerDown={tapCorner} role={corners.length < 4 ? 'button' : undefined} tabIndex={corners.length < 4 ? 0 : undefined} aria-label={corners.length < 4 ? t(dict, 'corner') : t(dict, 'camera')}>
      <video ref={videoRef} playsInline muted aria-hidden="true"/>
      <canvas ref={canvasRef} aria-label={t(dict, 'camera')}/>
      {corners.map((point, index) => <span key={index} className="calibration-dot" style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}>{index + 1}</span>)}
      {ready && cvReady && corners.length === 4 && <div className="zone-grid" aria-hidden="true"><span className="zone zone-red"/><span className="zone zone-blue"/><span className="zone zone-green"/><span className="zone zone-yellow"/></div>}
      {!ready && !error && <div className="camera-placeholder">{t(dict, 'cv_loading')}</div>}
    </div>
    <div className="camera-status"><span>{error || (!cvReady ? t(dict, 'cv_loading') : corners.length < 4 ? t(dict, 'camera_help') : t(dict, 'calibrated'))}</span><span aria-label="frames per second">{fps} FPS</span></div>
    {ready && corners.length < 4 && <p className="hint" aria-live="polite">{t(dict, 'corner')} {corners.length + 1}/4</p>}
    <p className="privacy-note">{t(dict, 'camera_privacy')}</p>
    <div className="sr-only" aria-live="polite">{frame.objects.length} objects detected{frame.hand_present ? ' and hand present' : ''}</div>
  </section>;
}
// @ts-nocheck
