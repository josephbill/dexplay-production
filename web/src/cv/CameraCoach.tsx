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
// The printed decoration coordinates are relative to the calibration dots in mat.svg.
const matMarkers = [
    { u: 101 / 384, v: 82 / 261 },
    { u: 283 / 384, v: 82 / 261 },
    { u: 101 / 384, v: 177 / 261 },
    { u: 283 / 384, v: 177 / 261 },
];
const matBoxes = [
    { u: (46 + 191 - 36) / (2 * 384), v: (70 + 148 - 36) / (2 * 261) },
    { u: (229 + 374 - 36) / (2 * 384), v: (70 + 148 - 36) / (2 * 261) },
    { u: (46 + 191 - 36) / (2 * 384), v: (165 + 243 - 36) / (2 * 261) },
    { u: (229 + 374 - 36) / (2 * 384), v: (165 + 243 - 36) / (2 * 261) },
];
function mapMatPoint(u, v, corners) {
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    return [
        topLeft[0] * (1 - u) * (1 - v) + topRight[0] * u * (1 - v) + bottomRight[0] * u * v + bottomLeft[0] * (1 - u) * v,
        topLeft[1] * (1 - u) * (1 - v) + topRight[1] * u * (1 - v) + bottomRight[1] * u * v + bottomLeft[1] * (1 - u) * v,
    ];
}
function zonePolygons(corners) {
    if (corners.length !== 4)
        return [];
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const top = midpoint(topLeft, topRight), right = midpoint(topRight, bottomRight);
    const bottom = midpoint(bottomLeft, bottomRight), left = midpoint(topLeft, bottomLeft);
    const center = [(topLeft[0] + topRight[0] + bottomRight[0] + bottomLeft[0]) / 4, (topLeft[1] + topRight[1] + bottomRight[1] + bottomLeft[1]) / 4];
    return [
        ['red', [topLeft, top, center, left]],
        ['blue', [top, topRight, right, center]],
        ['green', [left, center, bottom, bottomLeft]],
        ['yellow', [center, right, bottomRight, bottom]],
    ];
}
function zoneForPoint(point, corners) {
    return zonePolygons(corners).find(([, polygon]) => inside(point, polygon))?.[0] ?? null;
}
function isPrintedBox(bounds, corners, width, height) {
    if (corners.length !== 4)
        return false;
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const topWidth = Math.hypot((topRight[0] - topLeft[0]) * width, (topRight[1] - topLeft[1]) * height);
    const bottomWidth = Math.hypot((bottomRight[0] - bottomLeft[0]) * width, (bottomRight[1] - bottomLeft[1]) * height);
    const leftHeight = Math.hypot((bottomLeft[0] - topLeft[0]) * width, (bottomLeft[1] - topLeft[1]) * height);
    const rightHeight = Math.hypot((bottomRight[0] - topRight[0]) * width, (bottomRight[1] - topRight[1]) * height);
    for (const box of matBoxes) {
        const [cx, cy] = mapMatPoint(box.u, box.v, corners);
        const expectedWidth = (topWidth * (1 - box.v) + bottomWidth * box.v) * (145 / 384);
        const expectedHeight = (leftHeight * (1 - box.u) + rightHeight * box.u) * (78 / 261);
        const boxCenterX = (bounds.x + bounds.width / 2) / width, boxCenterY = (bounds.y + bounds.height / 2) / height;
        const centerDistance = Math.hypot((boxCenterX - cx) * width, (boxCenterY - cy) * height);
        const widthRatio = bounds.width / expectedWidth, heightRatio = bounds.height / expectedHeight;
        if (centerDistance < Math.min(expectedWidth, expectedHeight) * .1 && widthRatio > .65 && widthRatio < 1.35 && heightRatio > .65 && heightRatio < 1.35)
            return true;
    }
    return false;
}
function isPrintedMarker(point, area, corners, width, height) {
    if (corners.length !== 4)
        return false;
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    for (const marker of matMarkers) {
        const [cx, cy] = mapMatPoint(marker.u, marker.v, corners);
        const topWidth = Math.hypot((topRight[0] - topLeft[0]) * width, (topRight[1] - topLeft[1]) * height);
        const bottomWidth = Math.hypot((bottomRight[0] - bottomLeft[0]) * width, (bottomRight[1] - bottomLeft[1]) * height);
        const leftHeight = Math.hypot((bottomLeft[0] - topLeft[0]) * width, (bottomLeft[1] - topLeft[1]) * height);
        const rightHeight = Math.hypot((bottomRight[0] - topRight[0]) * width, (bottomRight[1] - topRight[1]) * height);
        const radiusX = (5 / 384) * (topWidth * (1 - marker.v) + bottomWidth * marker.v) * 1.4;
        const radiusY = (5 / 261) * (leftHeight * (1 - marker.u) + rightHeight * marker.u) * 1.4;
        const dx = (point[0] - cx) * width, dy = (point[1] - cy) * height;
        if ((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1 && area <= Math.PI * radiusX * radiusY * 2.25)
            return true;
    }
    return false;
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
export function CameraCoach({ active, clinic, dict, calibration, deviceId, onCorner, onFrame, onCameraReady, onCameraStatus, calibrationEnabled = true }) {
    const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null);
    const calibrationRef = useRef(calibration);
    calibrationRef.current = calibration;
    const callbackRef = useRef(onFrame);
    callbackRef.current = onFrame;
    const readyCallbackRef = useRef(onCameraReady);
    readyCallbackRef.current = onCameraReady;
    const statusCallbackRef = useRef(onCameraStatus);
    statusCallbackRef.current = onCameraStatus;
    const [error, setError] = useState(''), [ready, setReady] = useState(false), [cvReady, setCvReady] = useState(false), [corners, setCorners] = useState(calibration);
    const [fps, setFps] = useState(0), [frame, setFrame] = useState({ objects: [], hand_present: false, ts: 0 }), [attempt, setAttempt] = useState(0);
    const activeRef = useRef(active);
    activeRef.current = active;
    const width = clinic && window.innerWidth > 850 ? 640 : 320;
    const height = clinic && window.innerWidth > 850 ? 480 : 240;
    useEffect(() => setCorners(calibration), [calibration]);
    const tapCorner = useCallback((event) => {
        if (!calibrationEnabled || !ready || corners.length >= 4)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
        const next = [...corners, point];
        setCorners(next);
        onCorner(next);
    }, [calibrationEnabled, corners, onCorner, ready]);
    const updateCorners = (next) => {
        setCorners(next);
        onCorner(next);
    };
    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        videoRef.current?.pause();
        if (videoRef.current)
            videoRef.current.srcObject = null;
        const context = canvasRef.current?.getContext('2d');
        context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setFrame({ objects: [], hand_present: false, ts: 0 });
    }, []);
    useEffect(() => {
        if (!active) {
            setReady(false);
            setCvReady(false);
            setFps(0);
            stopCamera();
            statusCallbackRef.current?.('stopped');
            return;
        }
        let stopped = false, timer = 0, fpsFrames = 0, fpsStart = performance.now(), balance = null, cv, hasProcessedFrame = false;
        statusCallbackRef.current?.('starting');
        setError('');
        setReady(false);
        setCvReady(false);
        const start = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia)
                    throw new Error('camera-unavailable');
                const videoConstraints = { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 15, max: 15 } };
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
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx)
                    throw new Error('Could not create the camera processing canvas.');
                let lastProcess = -Infinity, lastUiUpdate = -Infinity;
                const process = (now) => {
                    if (stopped || !activeRef.current)
                        return;
                    try {
                        if (now - lastProcess >= 100 && video.readyState >= 2) {
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
                                                    const bounds = cv.boundingRect(contour);
                                                    if (isPrintedBox(bounds, calibrationRef.current, width, height))
                                                        continue;
                                                    const moments = cv.moments(contour);
                                                    if (!moments.m00)
                                                        continue;
                                                    const cx = moments.m10 / moments.m00 / width, cy = moments.m01 / moments.m00 / height;
                                                    if (isPrintedMarker([cx, cy], area, calibrationRef.current, width, height))
                                                        continue;
                                                    const zone_id = zoneForPoint([cx, cy], calibrationRef.current);
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
                                if (now - lastUiUpdate >= 250) {
                                    setFrame(result);
                                    lastUiUpdate = now;
                                }
                                callbackRef.current(result);
                            }
                            finally {
                                src.delete();
                                hsv.delete();
                            }
                            if (!hasProcessedFrame) {
                                hasProcessedFrame = true;
                                setCvReady(true);
                                statusCallbackRef.current?.('ready');
                            }
                            fpsFrames++;
                            if (now - fpsStart >= 1000) {
                                setFps(Math.round(fpsFrames * 1000 / (now - fpsStart)));
                                fpsFrames = 0;
                                fpsStart = now;
                            }
                        }
                    }
                    catch (err) {
                        if (!stopped) {
                            stopped = true;
                            window.clearTimeout(timer);
                            stopCamera();
                            setError(`${t(dict, 'camera_processing_error')} ${err instanceof Error ? err.message : ''}`.trim());
                            setReady(false);
                            setCvReady(false);
                            statusCallbackRef.current?.('error');
                        }
                        return;
                    }
                    timer = window.setTimeout(() => process(performance.now()), 100);
                };
                timer = window.setTimeout(() => process(performance.now()), 0);
            }
            catch (err) {
                if (!stopped) {
                    const hasLivePreview = Boolean(streamRef.current?.active);
                    if (!hasLivePreview)
                        stopCamera();
                    const name = err instanceof Error ? err.name : '';
                    const message = name === 'NotAllowedError' || name === 'SecurityError'
                        ? t(dict, 'camera_denied')
                        : (err instanceof Error && err.message === 'camera-unavailable') || name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError'
                            ? t(dict, 'camera_error')
                            : `${t(dict, 'camera_processing_error')} ${err instanceof Error ? err.message : ''}`.trim();
                    setError(message);
                    setReady(hasLivePreview);
                    setCvReady(false);
                    statusCallbackRef.current?.('error');
                }
            }
        };
        void start();
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            stopCamera();
            setReady(false);
            setCvReady(false);
            setFps(0);
            statusCallbackRef.current?.('stopped');
        };
    }, [active, attempt, clinic, dict, deviceId, stopCamera]);
    const retryCamera = () => {
        setError('');
        setAttempt(value => value + 1);
    };
    const zones = zonePolygons(corners);
    return <section className="camera-card" aria-label={t(dict, 'camera')}>
    <div className="camera-frame" style={{ aspectRatio: `${width} / ${height}` }} onPointerDown={tapCorner} role={calibrationEnabled && corners.length < 4 ? 'button' : undefined} tabIndex={calibrationEnabled && corners.length < 4 ? 0 : undefined} aria-label={calibrationEnabled && corners.length < 4 ? t(dict, 'corner') : t(dict, 'camera')}>
      <video ref={videoRef} playsInline muted aria-hidden="true"/>
      <canvas ref={canvasRef} aria-label={t(dict, 'camera')}/>
      {frame.objects.map((object, index) => <span key={`${object.color}-${index}`} className={`detected-object detected-${object.color}`} style={{ left: `${object.cx * 100}%`, top: `${object.cy * 100}%` }} aria-hidden="true"/>)}
      {corners.map((point, index) => <span key={index} className="calibration-dot" style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}>{index + 1}</span>)}
      {ready && cvReady && corners.length === 4 && <svg className="zone-grid" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{zones.map(([color, polygon]) => <polygon key={color} className={`zone zone-${color}`} points={polygon.map(point => point.join(',')).join(' ')}/>)}</svg>}
      {active && !ready && !error && <div className="camera-placeholder">{t(dict, 'cv_loading')}</div>}
    </div>
    <div className="camera-status"><span>{error || (!active ? t(dict, 'camera_paused') : !ready || !cvReady ? t(dict, 'cv_loading') : corners.length < 4 ? `${t(dict, 'corner')} ${corners.length + 1}/4` : t(dict, 'calibrated'))}</span><span aria-label="frames per second">{fps} FPS</span></div>
    {error && <button className="button secondary" onClick={retryCamera} disabled={!active}>{t(dict, 'camera_retry')}</button>}
    {calibrationEnabled && corners.length > 0 && <div className="camera-actions"><button className="button secondary" onClick={() => updateCorners(corners.slice(0, -1))}>{t(dict, 'undo_corner')}</button><button className="button secondary" onClick={() => updateCorners([])}>{t(dict, 'reset_calibration')}</button></div>}
    <p className="privacy-note">{t(dict, 'camera_privacy')}</p>
    <div className="sr-only" aria-live="polite">{frame.objects.length} objects detected{frame.hand_present ? ' and hand present' : ''}</div>
  </section>;
}
// @ts-nocheck
