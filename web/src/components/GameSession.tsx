// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraCoach } from '../cv/CameraCoach';
import { queueSync, saveSession } from '../db';
import { t } from '../i18n';
import { logOperationEvent, startOperation } from '../operationLog';

const API = import.meta.env.VITE_API_URL || '/api';
const colors = ['red', 'blue', 'green', 'yellow'];
const CORNER_NAMES = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

function speak(text, language) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}

function beep(freq = 880, duration = 90) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
}

function haptic() {
  if (navigator.vibrate) navigator.vibrate(40);
}

export function GameSession({
  profile,
  clinic,
  voice,
  dict,
  calibration,
  onCalibration,
  apiKey,
  aiConsent,
  onFinished,
  onClose,
}) {
  const [mode, setMode] = useState('sort_place');
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('starting');
  const [roundNum, setRoundNum] = useState(1);
  const [seconds, setSeconds] = useState(60);
  const [placed, setPlaced] = useState(0);
  const [fumbles, setFumbles] = useState(0);
  const [frame, setFrame] = useState({ objects: [], hand_present: false, ts: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cornerFeedback, setCornerFeedback] = useState(null); // { index, ts }

  const roundStart = useRef(0);
  const rowsRef = useRef([]);
  const lastUiFrame = useRef(0);
  const waitingForCamera = useRef(false);
  const lastCornerCount = useRef(calibration.length);
  const cameraStatusRef = useRef(cameraStatus);
  const sessionOperationRef = useRef(null);

  const target = colors[(roundNum - 1) % colors.length];
  const total = 4;
  const cameraOn =
    !started ||
    !paused ||
    resumePending ||
    cameraStatus === 'starting' ||
    cameraStatus === 'error';

  const instruction = useMemo(
    () => t(dict, 'target', { color: t(dict, `target_${target}`) }),
    [dict, target]
  );

  const nextCornerName = useMemo(() => {
    const idx = calibration.length;
    if (idx >= 4) return null;
    return t(dict, `corner_${CORNER_NAMES[idx]}`) || CORNER_NAMES[idx];
  }, [calibration.length, dict]);

  /* ------------------------------------------------------------------ *
   * Frame handler — MediaPipe emits one object per completed dwell.
   * Each object in `next.objects` is a discrete placement, not a
   * continuous detection, so no edge-detection refs are needed.
   * ------------------------------------------------------------------ */
  const handleFrame = useCallback(
    (next) => {
      if (next.ts - lastUiFrame.current >= 250) {
        setFrame(next);
        lastUiFrame.current = next.ts;
      }
      if (!started || paused) return;

      const placements = next.objects.filter((object) => object.zone_id === target);
      if (placements.length > 0) {
        setPlaced((value) => Math.min(total, value + placements.length));
        beep(660, 60);
        haptic();
      }

      const offTarget = next.objects.filter(
        (object) => object.zone_id && object.zone_id !== target
      );
      if (offTarget.length > 0) {
        setFumbles((value) => value + offTarget.length);
      }
    },
    [started, paused, target, total]
  );

  const handleCameraStatus = useCallback(
    (status) => {
      if (cameraStatusRef.current !== status) {
        if (sessionOperationRef.current) {
          sessionOperationRef.current.event('camera_status_changed', { status });
        } else {
          logOperationEvent('camera', 'status_changed', { status });
        }
        cameraStatusRef.current = status;
      }
      setCameraStatus(status);
      if (status === 'ready' && started) {
        if (waitingForCamera.current) {
          roundStart.current = Date.now();
          waitingForCamera.current = false;
        }
        if (resumePending) {
          setResumePending(false);
          setPaused(false);
        }
      } else if (status === 'error') {
        if (resumePending) setResumePending(false);
        if (started) setPaused(true);
      }
    },
    [resumePending, started]
  );

  /* ---------------------- corner calibration ---------------------- */

  const handleCorner = useCallback(
    (nextCorners, reason) => {
      if (!Array.isArray(nextCorners)) return;

      onCalibration(nextCorners);

      if (reason !== 'tap') return;
      const newIndex = nextCorners.length - 1;
      if (newIndex < 0) return;

      if (sessionOperationRef.current) {
        sessionOperationRef.current.event('calibration_updated', { status: reason, item_count: nextCorners.length });
      } else {
        logOperationEvent('game.calibration', reason, { item_count: nextCorners.length });
      }
      setCornerFeedback({ index: newIndex, ts: Date.now() });
      beep(880, 90);
      haptic();

      if (voice) {
        const name = t(dict, `corner_${CORNER_NAMES[newIndex]}`) || CORNER_NAMES[newIndex];
        if (newIndex < 3) {
          const nextName =
            t(dict, `corner_${CORNER_NAMES[newIndex + 1]}`) || CORNER_NAMES[newIndex + 1];
          speak(
            t(dict, 'corner_captured_next', { name, next: nextName }) ||
              `${name} captured. Next: ${nextName}.`,
            profile.language
          );
        } else {
          speak(
            t(dict, 'corner_captured_all', { name }) ||
              `${name} captured. Calibration complete!`,
            profile.language
          );
        }
      }
    },
    [onCalibration, voice, dict, profile.language]
  );

  const handleCornerRelease = useCallback(() => {
    /* debounce lives inside CameraCoach */
  }, []);

  useEffect(() => {
    if (!cornerFeedback) return;
    const id = window.setTimeout(() => setCornerFeedback(null), 1200);
    return () => window.clearTimeout(id);
  }, [cornerFeedback]);

  useEffect(() => {
    if (calibration.length === 4 && lastCornerCount.current !== 4) {
      if (voice)
        speak(t(dict, 'calibration_complete') || 'Calibration complete!', profile.language);
      beep(1200, 140);
      haptic();
    }
    lastCornerCount.current = calibration.length;
  }, [calibration.length, voice, dict, profile.language]);

  /* ---------------------------- timer ---------------------------- */

  useEffect(() => {
    if (!started || paused || cameraStatus !== 'ready') return;
    const id = window.setInterval(
      () => setSeconds((value) => (value <= 1 ? 0 : value - 1)),
      1000
    );
    return () => window.clearInterval(id);
  }, [started, paused, cameraStatus]);

  /* --------------------------- session --------------------------- */

  const session = useMemo(
    () => ({
      id: crypto.randomUUID(),
      profile_id: profile.id,
      patient_id: clinic ? profile.id : undefined,
      started_at: new Date().toISOString(),
      difficulty_params: profile.difficulty,
      mode,
    }),
    [profile, clinic, mode]
  );

  const completeRound = useCallback(async () => {
    if (!started) return;
    setPaused(true);
    const elapsed = Math.max(1, (Date.now() - roundStart.current) / 1000);
    const row = {
      id: `${profile.id}-${Date.now()}`,
      session_id: rowsRef.current[0]?.session_id || session.id,
      round_num: roundNum,
      mode,
      objects_placed: placed,
      objects_total: total,
      avg_time: Number((elapsed / Math.max(1, placed)).toFixed(1)),
      fumbles,
      accuracy: Number((placed / total).toFixed(3)),
    };
    const next = [...rowsRef.current, row];
    rowsRef.current = next;
    sessionOperationRef.current?.event('round_completed', { item_count: next.length });
    if (roundNum < 3) {
      setRoundNum((value) => value + 1);
      setPlaced(0);
      setFumbles(0);
      setSeconds(60);
      roundStart.current = Date.now();
      setPaused(false);
      if (voice) speak(instruction, profile.language);
      return;
    }
    setSaving(true);
    const endedAt = new Date().toISOString();
    const finishedSession = { ...session, ended_at: endedAt };
    const operation = sessionOperationRef.current ?? startOperation('game.session');
    operation.event('saving_local');
    try {
      await saveSession(finishedSession, next);
      operation.event('local_saved');
      const previousAccuracy = await recentSessionAccuracies(profile.id, session.id);
      const analysisProfile = {
        group: clinic ? 'clinic' : 'child',
        age_group: profile.age_group,
        language: profile.language,
        difficulty: profile.difficulty,
        recent_session_accuracy: previousAccuracy,
      };
      const reportPayload = next.map(
        ({ round_num, mode, objects_placed, objects_total, avg_time, fumbles, accuracy }) => ({
          round_num,
          mode,
          objects_placed,
          objects_total,
          avg_time,
          fumbles,
          accuracy,
        })
      );
      const payload = {
        session_data: next.map((item) => ({ ...item, session_id: session.id })),
        profile: {
          group: clinic ? 'clinic' : 'child',
          age_group: profile.age_group,
          language: profile.language,
          difficulty: profile.difficulty,
          recent_session_accuracy: previousAccuracy,
        },
        ai_consent: aiConsent,
        subscription_state: 'active',
        usage_stats: {
          free_sessions_count: await countLocalSessions(profile.id),
          difficulty_plateau: false,
          improvement_trend: 'unknown',
          has_therapist: clinic,
          therapist_requested_reports: false,
        },
        resource_preferences: {
          types: ['video', 'pdf', 'guide'],
          max_size_mb: 50,
          already_have: [],
        },
        patient_id: clinic ? profile.id : undefined,
      };
      if (apiKey) {
        if (navigator.onLine) {
          try {
            const result = await sendSync(payload, apiKey, operation.requestId);
            operation.event('cloud_sync_completed', { source: 'cloud' });
            operation.complete({ source: 'cloud', offline: false });
            onFinished(finishedSession, next, result);
          } catch (err) {
            operation.event('cloud_sync_unavailable', { source: 'cloud' });
            await queueSync(payload, profile.id);
            operation.complete({ source: 'offline_queue', offline: false });
            onFinished(
              finishedSession,
              next,
              localBriefReport(
                reportPayload,
                profile.language,
                'Cloud sync or AI analysis failed. Showing only measurements saved on this device.'
              )
            );
          }
        } else {
          await queueSync(payload, profile.id);
          operation.event('queued_for_sync', { source: 'offline_queue', offline: true });
          operation.complete({ source: 'offline_queue', offline: true });
          onFinished(
            finishedSession,
            next,
            localBriefReport(
              reportPayload,
              profile.language,
              'Offline: measurements are saved on this device; cloud AI was not available.'
            )
          );
        }
      } else if (aiConsent && navigator.onLine) {
        try {
          const result = await analyzeFreeSession({
            session_data: reportPayload,
            profile: analysisProfile,
            ai_consent: true,
          }, operation.requestId);
          operation.event('ai_analysis_completed', { source: 'cloud' });
          operation.complete({ source: 'cloud', offline: false });
          onFinished(finishedSession, next, result);
        } catch (err) {
          operation.event('ai_analysis_unavailable', { source: 'cloud' });
          operation.complete({ source: 'local', offline: false });
          onFinished(
            finishedSession,
            next,
            localBriefReport(
              reportPayload,
              profile.language,
              'Cloud AI analysis failed. Showing only measurements saved on this device.'
            )
          );
        }
      } else {
        operation.event('local_results_only', { source: 'local', offline: !navigator.onLine });
        operation.complete({ source: 'local', offline: !navigator.onLine });
        onFinished(
          finishedSession,
          next,
          localBriefReport(
            reportPayload,
            profile.language,
            aiConsent
              ? 'Offline: cloud AI was not available. Showing measurements saved on this device.'
              : 'AI analysis is off. No game data was sent to an AI provider.'
          )
        );
      }
    } catch (err) {
      operation.fail(err, { source: 'local' });
      setError(err instanceof Error ? err.message : 'Could not save this session.');
      setSaving(false);
    }
  }, [
    started,
    profile,
    roundNum,
    mode,
    placed,
    fumbles,
    total,
    clinic,
    apiKey,
    aiConsent,
    instruction,
    onFinished,
    voice,
    session,
  ]);

  useEffect(() => {
    if (started && !paused && cameraStatus === 'ready' && seconds === 0) {
      void completeRound();
    }
  }, [seconds, started, paused, cameraStatus, completeRound]);

  const start = () => {
    sessionOperationRef.current = startOperation('game.session');
    sessionOperationRef.current.event('game_started', { offline: !navigator.onLine });
    rowsRef.current = [];
    setRoundNum(1);
    setPlaced(0);
    setFumbles(0);
    setSeconds(60);
    waitingForCamera.current = cameraStatus !== 'ready';
    roundStart.current = Date.now();
    setStarted(true);
    setPaused(false);
    if (voice) speak(instruction, profile.language);
  };

  const resume = () => {
    if (cameraStatus === 'ready') {
      sessionOperationRef.current?.event('resumed');
      setPaused(false);
    } else {
      sessionOperationRef.current?.event('resume_waiting_for_camera');
      setResumePending(true);
    }
  };

  if (saving) {
    return (
      <section className="game-card" aria-live="polite">
        <div className="celebrate">🌟</div>
        <h2>{t(dict, 'complete')}</h2>
        <p>{t(dict, 'session_saved')}</p>
        <button className="button primary" onClick={onClose}>
          {t(dict, 'continue')}
        </button>
      </section>
    );
  }

  return (
    <section className="game-view" aria-label={t(dict, 'play_title')}>
      <CameraCoach
        active={cameraOn}
        clinic={clinic}
        dict={dict}
        calibration={calibration}
        onCorner={handleCorner}
        onCornerRelease={handleCornerRelease}
        onFrame={handleFrame}
        onCameraStatus={handleCameraStatus}
        calibrationEnabled={!started}
      />

      {/* --- Calibration UI: needs corners --- */}
      {!started && calibration.length !== 4 && (
        <div className="mode-picker calibration-panel">
          <h2>{t(dict, 'camera')}</h2>
          <p className="notice">{t(dict, 'camera_help')}</p>

          <div
            className="corner-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={calibration.length}
          >
            {CORNER_NAMES.map((name, i) => {
              const done = i < calibration.length;
              const justCaptured = cornerFeedback?.index === i;
              return (
                <div
                  key={name}
                  className={`corner-badge ${done ? 'done' : ''} ${justCaptured ? 'pulse' : ''}`}
                  aria-label={`${t(dict, `corner_${name}`) || name}: ${done ? 'done' : 'pending'}`}
                >
                  <span className="corner-icon" aria-hidden="true">
                    {done ? '✓' : ['↖', '↗', '↘', '↙'][i]}
                  </span>
                  <span className="corner-label">
                    {t(dict, `corner_${name}`) || name}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="corner-counter" aria-live="polite">
            <strong>{calibration.length}/4</strong>{' '}
            {calibration.length < 4 ? (
              <>
                — {t(dict, 'next_corner') || 'Next:'} <b>{nextCornerName}</b>
              </>
            ) : (
              t(dict, 'calibration_complete') || 'Calibration complete!'
            )}
          </p>

          <a className="text-link" href="/mat.svg" target="_blank" rel="noreferrer">
            {t(dict, 'mat')}
          </a>
        </div>
      )}

      {/* --- Calibration UI: ready to start --- */}
      {!started && calibration.length === 4 && (
        <div className="mode-picker">
          <h2>{t(dict, 'play_title')}</h2>
          <div className="mode-grid">
            {['sort_place', 'stack', 'thread', 'button'].map((item, index) => (
              <button
                key={item}
                className={`mode-card ${mode === item ? 'selected' : ''}`}
                onClick={() => setMode(item)}
                aria-pressed={mode === item}
              >
                <span aria-hidden="true">{['🔴', '🧱', '🧵', '🟡'][index]}</span>
                <strong>{t(dict, item)}</strong>
              </button>
            ))}
          </div>
          <a className="text-link" href="/mat.svg" target="_blank" rel="noreferrer">
            {t(dict, 'mat')}
          </a>
          {cameraStatus !== 'ready' && <p className="notice">{t(dict, 'camera_waiting')}</p>}
          <button className="button primary large" onClick={start}>
            {t(dict, 'start')}
          </button>
        </div>
      )}

      {started && (
        <div className="game-top">
          <div>
            <small>
              {t(dict, 'round')} {roundNum}/3
            </small>
            <h2>{instruction}</h2>
          </div>
          <div className="game-score">
            <span>
              {t(dict, 'time_left')} <b>{seconds}s</b>
            </span>
            <span>
              {t(dict, 'score')} <b>{placed}/{total}</b>
            </span>
          </div>
        </div>
      )}

      {started && (
        <>
          <p className="game-status" aria-live="polite">
            {frame.hand_present ? '✋ ' : ''}
            {placed === total ? t(dict, 'complete') : `${t(dict, 'score')}: ${placed}/${total}`}
          </p>
          <div className="game-actions">
            <button
              className="button secondary large"
              onClick={() => {
                if (paused) {
                  resume();
                } else {
                  sessionOperationRef.current?.event('paused');
                  setPaused(true);
                }
              }}
              disabled={resumePending}
            >
              {resumePending
                ? t(dict, 'cv_loading')
                : paused
                ? t(dict, 'resume')
                : t(dict, 'pause')}
            </button>
            <button
              className="button primary large"
              disabled={saving}
              onClick={() => void completeRound()}
            >
              {t(dict, 'finish')}
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}

async function countLocalSessions(profileId) {
  const { recentSessions } = await import('../db');
  return (await recentSessions(profileId, 1000)).length + 1;
}

async function recentSessionAccuracies(profileId, currentSessionId) {
  const { db, recentSessions } = await import('../db');
  const database = await db();
  const previous = (await recentSessions(profileId, 1000))
    .filter((item) => item.id !== currentSessionId)
    .slice(0, 3);
  const accuracies = [];
  for (const item of previous) {
    const rounds = await database.getAllFromIndex('rounds', 'by-session', item.id);
    if (rounds.length) {
      accuracies.push(
        rounds.reduce((sum, round) => sum + round.accuracy, 0) / rounds.length
      );
    }
  }
  return accuracies;
}

async function analyzeFreeSession(payload, requestId) {
  const response = await fetch(`${API}/analysis/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Free session analysis is unavailable.');
  }
  return response.json();
}

function localBriefReport(rounds, language, analysisStatus) {
  const placed = rounds.reduce((sum, round) => sum + round.objects_placed, 0);
  const total = rounds.reduce((sum, round) => sum + round.objects_total, 0);
  return {
    report: {
      patient: null,
    },
    performance: {
      rounds: rounds.length,
      objects_placed: placed,
      objects_total: total,
      accuracy: rounds.reduce((sum, round) => sum + round.accuracy, 0) / rounds.length,
    },
    new_resources: [],
    resource_gaps: [],
    ai_generated: false,
    analysis_status: analysisStatus,
  };
}

async function sendSync(payload, apiKey, requestId) {
  const response = await fetch(`${API}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': apiKey, 'X-Request-ID': requestId },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'DexPlay key is invalid or revoked.'
        : 'Cloud sync is currently unavailable.'
    );
  }
  return response.json();
}