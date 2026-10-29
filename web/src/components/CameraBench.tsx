// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraCoach } from '../cv/CameraCoach';
import { dictionary } from '../i18n';
export function CameraBench() {
    const [cameras, setCameras] = useState([]), [deviceId, setDeviceId] = useState(''), [running, setRunning] = useState(false);
    const [profile, setProfile] = useState('mobile'), [settings, setSettings] = useState({}), [fps, setFps] = useState(0), [frames, setFrames] = useState(0), [error, setError] = useState('');
    const frameCount = useRef(0), dict = dictionary('en');
    const refreshDevices = useCallback(async () => {
        if (!navigator.mediaDevices?.enumerateDevices)
            return;
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'videoinput');
        setCameras(devices.map((item, index) => ({ deviceId: item.deviceId, label: item.label || `Camera ${index + 1}` })));
        if (!deviceId && devices[0])
            setDeviceId(devices[0].deviceId);
    }, [deviceId]);
    useEffect(() => { void refreshDevices().catch(err => setError(String(err))); const timer = window.setInterval(() => { setFps(frameCount.current); setFrames(value => value + frameCount.current); frameCount.current = 0; }, 1000); return () => window.clearInterval(timer); }, [refreshDevices]);
    const onFrame = useCallback((_frame) => { frameCount.current++; }, []);
    const onReady = useCallback((next) => { setSettings(next); setError(''); void refreshDevices(); }, [refreshDevices]);
    const restart = (nextDevice = deviceId, nextProfile = profile) => { setRunning(false); setSettings({}); setFps(0); setError(''); setDeviceId(nextDevice); setProfile(nextProfile); window.setTimeout(() => setRunning(true), 50); };
    const resolution = `${settings.width ?? '—'} × ${settings.height ?? '—'}`;
    return <main className="camera-bench page">
    <p className="eyebrow">Development QA</p><h1>Camera frame-rate check</h1>
    <p>Video is processed locally by OpenCV.js. This page does not create a profile or send frames to the API.</p>
    <div className="panel bench-controls">
      <label>USB camera<select value={deviceId} onChange={event => restart(event.target.value)}>{cameras.map(camera => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}</select></label>
      <label>Capture profile<select value={profile} onChange={event => restart(deviceId, event.target.value)}><option value="mobile">Mobile · 320 × 240 · target 10 processed FPS</option><option value="clinic">Clinic · 640 × 480 · target 10 processed FPS</option></select></label>
      <button className="button primary" onClick={() => restart()}>{running ? 'Restart camera' : 'Start camera'}</button>
      <button className="button secondary" onClick={() => setRunning(false)}>Stop</button>
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="bench-results" aria-live="polite"><article className="panel"><span>OpenCV processed FPS</span><strong>{running ? fps : 0}</strong><small>Current 1-second sample; target 10 FPS</small></article><article className="panel"><span>Camera track</span><strong>{resolution}</strong><small>Advertised track rate: {settings.frameRate ?? '—'} FPS · {settings.facingMode ?? 'USB / external'}</small></article><article className="panel"><span>Frames processed</span><strong>{frames.toLocaleString()}</strong><small>Since the test started</small></article></div>
    <CameraCoach active={running} clinic={profile === 'clinic'} dict={dict} calibration={[]} deviceId={deviceId || undefined} onCorner={() => { }} onFrame={onFrame} onCameraReady={onReady} calibrationEnabled={false}/>
  </main>;
}
// @ts-nocheck
