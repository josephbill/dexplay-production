// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

/* ------------------------------------------------------------------ *
 * Geometry helpers (unchanged API, no OpenCV)
 * ------------------------------------------------------------------ */

function inside(point, polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
        const crosses =
            (yi > point[1]) !== (yj > point[1]) &&
            point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-9) + xi;
        if (crosses) hit = !hit;
    }
    return hit;
}

function zonePolygons(corners) {
    if (corners.length !== 4) return [];
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const top = midpoint(topLeft, topRight);
    const right = midpoint(topRight, bottomRight);
    const bottom = midpoint(bottomLeft, bottomRight);
    const left = midpoint(topLeft, bottomLeft);
    const center = [
        (topLeft[0] + topRight[0] + bottomRight[0] + bottomLeft[0]) / 4,
        (topLeft[1] + topRight[1] + bottomRight[1] + bottomLeft[1]) / 4,
    ];
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

const DWELL_MS = 700;
const DWELL_COOLDOWN_MS = 900;
const INDEX_TIP = 8;

const CORNER_LABELS = [
    'corner_top_left',
    'corner_top_right',
    'corner_bottom_right',
    'corner_bottom_left',
];

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function CameraCoach({
    active,
    clinic,
    dict,
    calibration,
    deviceId,
    onCorner,
    onCornerRelease,
    onFrame,
    onCameraStatus,
    onCameraReady,
    calibrationEnabled = true,
}) {
    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const streamRef = useRef(null);
    const workerRef = useRef(null);

    const calibrationRef = useRef(calibration);
    calibrationRef.current = calibration;
    const callbackRef = useRef(onFrame);
    callbackRef.current = onFrame;
    const statusCallbackRef = useRef(onCameraStatus);
    statusCallbackRef.current = onCameraStatus;
    const onCornerRef = useRef(onCorner);
    onCornerRef.current = onCorner;
    const onCornerReleaseRef = useRef(onCornerRelease);
    onCornerReleaseRef.current = onCornerRelease;
    const readyCallbackRef = useRef(onCameraReady);
    readyCallbackRef.current = onCameraReady;

    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);
    const [cvReady, setCvReady] = useState(false);
    const [corners, setCorners] = useState(calibration);
    const [fps, setFps] = useState(0);
    const [frame, setFrame] = useState({ objects: [], hand_present: false, ts: 0 });
    const [attempt, setAttempt] = useState(0);

    const activeRef = useRef(active);
    activeRef.current = active;

    const lastTapTs = useRef(0);
    const dwellRef = useRef({ zone: null, since: 0, lastFiredZone: null, lastFiredAt: 0 });

    const width = clinic && window.innerWidth > 850 ? 320 : 240;
    const height = clinic && window.innerWidth > 850 ? 240 : 180;

    useEffect(() => setCorners(calibration), [calibration]);

    /* --------------------- calibration tap handling --------------------- */

    const emitCornerChange = useCallback((next, reason) => {
        const now = Date.now();
        if (now - lastTapTs.current < 350) return false;
        lastTapTs.current = now;
        setCorners(next);
        onCornerRef.current?.(next, reason);
        return true;
    }, []);

    const tapCorner = useCallback(
        (event) => {
            if (!calibrationEnabled || !ready || corners.length >= 4) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const point = [
                Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
            ];
            emitCornerChange([...corners, point], 'tap');
        },
        [calibrationEnabled, corners, ready, emitCornerChange]
    );

    const undoCorner = () => {
        if (corners.length === 0) return;
        emitCornerChange(corners.slice(0, -1), 'undo');
        onCornerReleaseRef.current?.();
    };

    const resetCalibration = () => {
        if (corners.length === 0) return;
        emitCornerChange([], 'reset');
        onCornerReleaseRef.current?.();
    };

    /* --------------------------- lifecycle --------------------------- */

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        videoRef.current?.pause();
        if (videoRef.current) videoRef.current.srcObject = null;
        const ctx = overlayRef.current?.getContext('2d');
        if (ctx && overlayRef.current) {
            ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
        }
        setFrame({ objects: [], hand_present: false, ts: 0 });
        dwellRef.current = { zone: null, since: 0, lastFiredZone: null, lastFiredAt: 0 };
    }, []);

    /* ---------------------- Worker Result Handler ---------------------- */
    
    const processWorkerResults = (results, timestamp) => {
        if (!activeRef.current) return;

        const hands = results?.landmarks ?? [];
        const primary = hands[0] ?? null;
        const handPresent = Boolean(primary);
        
        const objects = [];
        let activeZone = null;
        const nowMs = Date.now();

        if (primary && calibrationRef.current.length === 4) {
            const tip = primary[INDEX_TIP];
            const tipPoint = [tip.x, tip.y];
            activeZone = zoneForPoint(tipPoint, calibrationRef.current);

            if (activeZone) {
                const dwell = dwellRef.current;

                if (dwell.zone !== activeZone) {
                    dwell.zone = activeZone;
                    dwell.since = nowMs;
                } else if (
                    nowMs - dwell.since >= DWELL_MS &&
                    (dwell.lastFiredZone !== activeZone ||
                        nowMs - dwell.lastFiredAt >= DWELL_COOLDOWN_MS)
                ) {
                    objects.push({
                        color: activeZone,
                        cx: tip.x,
                        cy: tip.y,
                        zone_id: activeZone,
                        dwell_ms: nowMs - dwell.since,
                    });
                    dwell.lastFiredZone = activeZone;
                    dwell.lastFiredAt = nowMs;
                    dwell.zone = null;
                    dwell.since = 0;
                }
            } else {
                dwellRef.current.zone = null;
                dwellRef.current.since = 0;
            }

            // Draw overlay
            const overlay = overlayRef.current;
            const ctx = overlay?.getContext('2d');
            if (ctx && overlay) {
                ctx.clearRect(0, 0, width, height);
                const px = tip.x * width;
                const py = tip.y * height;
                ctx.beginPath();
                ctx.arc(px, py, 6, 0, Math.PI * 2);
                ctx.fillStyle = activeZone ? '#22c55e' : '#f59e0b';
                ctx.fill();

                if (activeZone) {
                    const elapsed = Date.now() - dwellRef.current.since;
                    const pct = Math.min(1, elapsed / DWELL_MS);
                    ctx.beginPath();
                    ctx.arc(px, py, 18, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
                    ctx.strokeStyle = '#22c55e';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            }
        } else {
            const ctx = overlayRef.current?.getContext('2d');
            if (ctx && overlayRef.current) {
                ctx.clearRect(0, 0, width, height);
            }
            dwellRef.current.zone = null;
            dwellRef.current.since = 0;
        }

        const result = { objects, hand_present: handPresent, ts: nowMs };
        
        // Update UI
        setFrame(result);
        callbackRef.current(result);
    };

    /* --------------------------- Camera & Worker Effect --------------------------- */

    useEffect(() => {
        if (!active) {
            setReady(false);
            setCvReady(false);
            setFps(0);
            stopCamera();
            statusCallbackRef.current?.('stopped');
            return;
        }

        let stopped = false;
        let fpsFrames = 0;
        let fpsStart = performance.now();
        let frameId;

        statusCallbackRef.current?.('starting');
        setError('');
        setReady(false);
        setCvReady(false);

        // 1. Initialize Worker
        const worker = new Worker(new URL('./hand-worker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (event) => {
            const { type, results, timestamp, message } = event.data;
            if (type === 'ready') {
                setCvReady(true);
                statusCallbackRef.current?.('ready');
            } else if (type === 'result') {
                processWorkerResults(results, timestamp);
                
                fpsFrames++;
                if (performance.now() - fpsStart >= 1000) {
                    setFps(Math.round((fpsFrames * 1000) / (performance.now() - fpsStart)));
                    fpsFrames = 0;
                    fpsStart = performance.now();
                }
            } else if (type === 'error') {
                setError(`${t(dict, 'camera_processing_error')} ${message}`.trim());
                statusCallbackRef.current?.('error');
            }
        };

        worker.postMessage({ type: 'init' });

        // 2. Start Camera
        const startCamera = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('camera-unavailable');
                }

                const videoConstraints = {
                    ...(deviceId
                        ? { deviceId: { exact: deviceId } }
                        : { facingMode: { ideal: 'environment' } }),
                    width: { ideal: width },
                    height: { ideal: height },
                    frameRate: { ideal: 15, max: 15 },
                };
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: videoConstraints,
                });
                
                if (stopped) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                
                streamRef.current = stream;
                readyCallbackRef.current?.(stream.getVideoTracks()[0]?.getSettings() ?? {});

                const video = videoRef.current;
                video.srcObject = stream;
                await video.play();
                
                if (overlayRef.current) {
                    overlayRef.current.width = width;
                    overlayRef.current.height = height;
                }
                setReady(true);

                // 3. Start Frame Loop
                const loop = async () => {
                    if (stopped) return;
                    const v = videoRef.current;
                    if (v && v.readyState >= 2) {
                        try {
                            const bitmap = await createImageBitmap(v);
                            worker.postMessage(
                                { type: 'detect', imageBitmap: bitmap, timestamp: performance.now() },
                                [bitmap]
                            );
                        } catch (e) {
                            // Ignore intermittent bitmap creation errors
                        }
                    }
                    frameId = requestAnimationFrame(loop);
                };
                loop();

            } catch (err) {
                if (!stopped) {
                    const hasLivePreview = Boolean(streamRef.current?.active);
                    if (!hasLivePreview) stopCamera();
                    const name = err instanceof Error ? err.name : '';
                    const message =
                        name === 'NotAllowedError' || name === 'SecurityError'
                            ? t(dict, 'camera_denied')
                            : (err instanceof Error && err.message === 'camera-unavailable') ||
                              name === 'NotFoundError' ||
                              name === 'OverconstrainedError' ||
                              name === 'NotReadableError'
                            ? t(dict, 'camera_error')
                            : `${t(dict, 'camera_processing_error')} ${
                                  err instanceof Error ? err.message : ''
                              }`.trim();
                    setError(message);
                    setReady(hasLivePreview);
                    setCvReady(false);
                    statusCallbackRef.current?.('error');
                }
            }
        };

        void startCamera();

        return () => {
            stopped = true;
            cancelAnimationFrame(frameId);
            worker.terminate();
            workerRef.current = null;
            stopCamera();
            setReady(false);
            setCvReady(false);
            setFps(0);
            statusCallbackRef.current?.('stopped');
        };
    }, [active, attempt, clinic, dict, deviceId, stopCamera]);

    const retryCamera = () => {
        setError('');
        setAttempt((v) => v + 1);
    };

    /* --------------------------- render --------------------------- */

    const zones = zonePolygons(corners);
    const nextIndex = corners.length;
    const nextCornerLabel =
        nextIndex < 4 ? t(dict, CORNER_LABELS[nextIndex]) || CORNER_LABELS[nextIndex] : null;

    return (
        <section className="camera-card" aria-label={t(dict, 'camera')}>
            <div
                className="camera-frame"
                style={{ aspectRatio: `${width} / ${height}` }}
                onPointerDown={tapCorner}
                role={calibrationEnabled && corners.length < 4 ? 'button' : undefined}
                tabIndex={calibrationEnabled && corners.length < 4 ? 0 : undefined}
                aria-label={
                    calibrationEnabled && corners.length < 4
                        ? `${t(dict, 'corner')} ${nextIndex + 1}/4${
                              nextCornerLabel ? ` – ${nextCornerLabel}` : ''
                          }`
                        : t(dict, 'camera')
                }
            >
                <video ref={videoRef} playsInline muted aria-hidden="true" />
                <canvas ref={overlayRef} className="camera-overlay" aria-label={t(dict, 'camera')} />

                {frame.objects.map((object, index) => (
                    <span
                        key={`${object.color}-${index}`}
                        className={`detected-object detected-${object.color}`}
                        style={{ left: `${object.cx * 100}%`, top: `${object.cy * 100}%` }}
                        aria-hidden="true"
                    />
                ))}
                {corners.map((point, index) => (
                    <span
                        key={index}
                        className="calibration-dot"
                        style={{ left: `${point[0] * 100}%`, top: `${point[1] * 100}%` }}
                    >
                        {index + 1}
                    </span>
                ))}
                {ready && cvReady && corners.length === 4 && (
                    <svg
                        className="zone-grid"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        {zones.map(([color, polygon]) => (
                            <polygon
                                key={color}
                                className={`zone zone-${color}`}
                                points={polygon.map((p) => p.join(',')).join(' ')}
                            />
                        ))}
                    </svg>
                )}
                {active && !ready && !error && (
                    <div className="camera-placeholder">{t(dict, 'cv_loading')}</div>
                )}
            </div>

            <div className="camera-status">
                <span>
                    {error ||
                        (!active
                            ? t(dict, 'camera_paused')
                            : !ready || !cvReady
                            ? t(dict, 'cv_loading')
                            : corners.length < 4
                            ? `${t(dict, 'corner')} ${corners.length + 1}/4${
                                  nextCornerLabel ? ` – ${nextCornerLabel}` : ''
                              }`
                            : t(dict, 'calibrated'))}
                </span>
                <span aria-label="frames per second">{fps} FPS</span>
            </div>

            {error && (
                <button className="button secondary" onClick={retryCamera} disabled={!active}>
                    {t(dict, 'camera_retry')}
                </button>
            )}

            {calibrationEnabled && corners.length > 0 && (
                <div className="camera-actions">
                    <button className="button secondary" onClick={undoCorner}>
                        {t(dict, 'undo_corner')}
                    </button>
                    <button className="button secondary" onClick={resetCalibration}>
                        {t(dict, 'reset_calibration')}
                    </button>
                </div>
            )}

            <p className="privacy-note">{t(dict, 'camera_privacy')}</p>

            <div className="sr-only" aria-live="polite">
                {frame.hand_present ? 'Hand detected' : 'No hand'}
                {frame.objects.length ? ` · ${frame.objects.length} dwell placement` : ''}
            </div>
        </section>
    );
}