// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraCoach } from '../cv/CameraCoach';
import { queueSync, saveSession } from '../db';
import { t } from '../i18n';
const colors = ['red', 'blue', 'green', 'yellow'];
function speak(text, language) {
    if (!('speechSynthesis' in window))
        return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = .88;
    window.speechSynthesis.speak(utterance);
}
export function GameSession({ profile, clinic, voice, dict, calibration, onCalibration, apiKey, onFinished, onClose }) {
    const [mode, setMode] = useState('sort_place'), [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [resumePending, setResumePending] = useState(false), [cameraStatus, setCameraStatus] = useState('starting'), [roundNum, setRoundNum] = useState(1);
    const [seconds, setSeconds] = useState(60), [placed, setPlaced] = useState(0), [fumbles, setFumbles] = useState(0), [frame, setFrame] = useState({ objects: [], hand_present: false, ts: 0 }), [saving, setSaving] = useState(false), [error, setError] = useState('');
    const prevRight = useRef(false), prevWrong = useRef(false), roundStart = useRef(0), rowsRef = useRef([]), lastUiFrame = useRef(0);
    const target = colors[(roundNum - 1) % colors.length], total = 4;
    const cameraOn = !started || !paused || resumePending;
    const instruction = useMemo(() => t(dict, 'target', { color: t(dict, `target_${target}`) }), [dict, target]);
    const handleFrame = useCallback((next) => {
        if (next.ts - lastUiFrame.current >= 250) {
            setFrame(next);
            lastUiFrame.current = next.ts;
        }
        if (!started || paused)
            return;
        const right = next.objects.some(object => object.color === target && object.zone_id === target);
        const wrong = next.objects.some(object => object.zone_id === target && object.color !== target);
        if (right && !prevRight.current)
            setPlaced(value => Math.min(total, value + 1));
        if (wrong && !prevWrong.current)
            setFumbles(value => value + 1);
        prevRight.current = right;
        prevWrong.current = wrong;
    }, [started, paused, target, total]);
    const handleCameraStatus = useCallback((status) => {
        setCameraStatus(status);
        if (status === 'ready' && started) {
            if (resumePending) {
                setResumePending(false);
                setPaused(false);
            }
        }
        else if (status === 'error') {
            if (resumePending)
                setResumePending(false);
            if (started)
                setPaused(true);
        }
    }, [resumePending, started]);
    useEffect(() => {
        if (!started || paused || cameraStatus !== 'ready')
            return;
        const id = window.setInterval(() => setSeconds(value => value <= 1 ? 0 : value - 1), 1000);
        return () => window.clearInterval(id);
    }, [started, paused, cameraStatus]);
    const completeRound = useCallback(async () => {
        if (!started)
            return;
        setPaused(true);
        const elapsed = Math.max(1, (Date.now() - roundStart.current) / 1000);
        const row = { id: `${profile.id}-${Date.now()}`, session_id: rowsRef.current[0]?.session_id || session.id, round_num: roundNum, mode,
            objects_placed: placed, objects_total: total, avg_time: Number((elapsed / Math.max(1, placed)).toFixed(1)), fumbles, accuracy: Number((placed / total).toFixed(3)) };
        const next = [...rowsRef.current, row];
        rowsRef.current = next;
        if (roundNum < 3) {
            setRoundNum(value => value + 1);
            setPlaced(0);
            setFumbles(0);
            setSeconds(60);
            prevRight.current = false;
            prevWrong.current = false;
            roundStart.current = Date.now();
            setPaused(false);
            if (voice)
                speak(instruction, profile.language);
            return;
        }
        setSaving(true);
        const endedAt = new Date().toISOString(), finishedSession = { ...session, ended_at: endedAt };
        try {
            await saveSession(finishedSession, next);
            const payload = { session_data: next.map(item => ({ ...item, session_id: session.id })), profile: { group: clinic ? 'clinic' : 'child', age_years: profile.age_years, age_group: profile.age_group, condition: profile.condition, hand: profile.hand, language: profile.language, difficulty: profile.difficulty, no_timer: profile.condition === 'parkinsons' }, subscription_state: 'active', usage_stats: { free_sessions_count: await countLocalSessions(profile.id), difficulty_plateau: false, improvement_trend: 'unknown', has_therapist: clinic, therapist_requested_reports: false }, resource_preferences: { types: ['video', 'pdf', 'guide'], max_size_mb: 50, already_have: [] }, patient_id: clinic ? profile.id : undefined };
            if (apiKey) {
                if (navigator.onLine) {
                    try {
                        const result = await sendSync(payload, apiKey);
                        onFinished(finishedSession, next, result);
                    }
                    catch {
                        await queueSync(payload);
                        onFinished(finishedSession, next);
                    }
                }
                else {
                    await queueSync(payload);
                    onFinished(finishedSession, next);
                }
            }
            else
                onFinished(finishedSession, next);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save this session.');
            setSaving(false);
        }
    }, [started, profile, roundNum, mode, placed, fumbles, total, clinic, apiKey, instruction, onFinished, voice]);
    const session = useMemo(() => ({ id: crypto.randomUUID(), profile_id: profile.id, patient_id: clinic ? profile.id : undefined, started_at: new Date().toISOString(), difficulty_params: profile.difficulty, mode }), [profile, clinic, mode]);
    useEffect(() => { if (started && !paused && cameraStatus === 'ready' && seconds === 0)
        void completeRound(); }, [seconds, started, paused, cameraStatus, completeRound]);
    const start = () => { rowsRef.current = []; setRoundNum(1); setPlaced(0); setFumbles(0); setSeconds(60); roundStart.current = Date.now(); setStarted(true); setPaused(false); if (voice)
        speak(instruction, profile.language); };
    const resume = () => {
        if (cameraStatus === 'ready') {
            setPaused(false);
        }
        else
            setResumePending(true);
    };
    if (saving)
        return <section className="game-card" aria-live="polite"><div className="celebrate">🌟</div><h2>{t(dict, 'complete')}</h2><p>{t(dict, 'session_saved')}</p><button className="button primary" onClick={onClose}>{t(dict, 'continue')}</button></section>;
    return <section className="game-view" aria-label={t(dict, 'play_title')}>
    {!started && <div className="mode-picker"><h2>{t(dict, 'play_title')}</h2><div className="mode-grid">
      {['sort_place', 'stack', 'thread', 'button'].map((item, index) => <button key={item} className={`mode-card ${mode === item ? 'selected' : ''}`} onClick={() => setMode(item)} aria-pressed={mode === item}><span aria-hidden="true">{['🔴', '🧱', '🧵', '🟡'][index]}</span><strong>{t(dict, item)}</strong></button>)}
    </div><a className="text-link" href="/mat.svg" target="_blank" rel="noreferrer">{t(dict, 'mat')}</a>{calibration.length !== 4 && <p className="notice">{t(dict, 'camera_help')}</p>}<button className="button primary large" disabled={calibration.length !== 4 || cameraStatus !== 'ready'} onClick={start}>{t(dict, 'start')}</button></div>}
    {started && <div className="game-top"><div><small>{t(dict, 'round')} {roundNum}/3</small><h2>{instruction}</h2></div><div className="game-score"><span>{t(dict, 'time_left')} <b>{seconds}s</b></span><span>{t(dict, 'score')} <b>{placed}/{total}</b></span></div></div>}
    <CameraCoach active={cameraOn} clinic={clinic} dict={dict} calibration={calibration} onCorner={onCalibration} onFrame={handleFrame} onCameraStatus={handleCameraStatus} calibrationEnabled={!started}/>
    {started && <>
      <p className="game-status" aria-live="polite">{frame.hand_present ? '✋ ' : ''}{placed === total ? t(dict, 'complete') : `${t(dict, 'score')}: ${placed}/${total}`}</p>
      <div className="game-actions"><button className="button secondary large" onClick={() => paused ? resume() : setPaused(true)} disabled={resumePending}>{resumePending ? t(dict, 'cv_loading') : paused ? t(dict, 'resume') : t(dict, 'pause')}</button><button className="button primary large" disabled={saving} onClick={() => void completeRound()}>{t(dict, 'finish')}</button></div>
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
async function countLocalSessions(profileId) { const { recentSessions } = await import('../db'); return (await recentSessions(profileId, 1000)).length + 1; }
async function sendSync(payload, apiKey) {
    const response = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': apiKey }, body: JSON.stringify(payload) });
    if (!response.ok)
        throw new Error(response.status === 401 ? 'DexPlay key is invalid or revoked.' : 'Cloud sync is currently unavailable.');
    const result = await response.json();
    return result;
}
// @ts-nocheck
