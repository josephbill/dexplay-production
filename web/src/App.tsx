// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, getSetting, pendingSyncCount, recentSessions, setSetting } from './db';
import { languages, detectLanguage, dictionary, t } from './i18n';
import { aiConsentDescription } from './i18n/aiConsent';
import { logOperationEvent, startOperation } from './operationLog';
import { GameSession } from './components/GameSession';
import { CameraCoach } from './cv/CameraCoach';
import { CameraBench } from './components/CameraBench';
const API = import.meta.env.VITE_API_URL || '/api';
function makeProfile(group, name, age, condition, hand, language) {
    return { id: crypto.randomUUID(), group, name: name.trim(), age_years: age, age_group: age <= 6 ? '4-6' : age <= 9 ? '7-9' : '10-12', condition, hand, language, created_at: new Date().toISOString(), difficulty: { object_size_mm: 22, time_limit_s: 75, objects_count: 5, zone_size_mm: 80, speed_factor: 1 } };
}
function localText(dict, key, values = {}) { return t(dict, key, values); }
function ProfileForm({ group, dict, language, onSubmit, onCancel }) {
    const [name, setName] = useState(''), [age, setAge] = useState(7), [condition, setCondition] = useState(''), [hand, setHand] = useState('both'), [patientLanguage, setPatientLanguage] = useState(language), [consent, setConsent] = useState(false);
    function submit(event) { event.preventDefault(); if (!consent)
        return; onSubmit(makeProfile(group, name, age, condition, hand, patientLanguage)); }
    return <form className="profile-form panel" onSubmit={submit}>
    <label>{localText(dict, 'child_name')}<input autoComplete="off" value={name} onChange={event => setName(event.target.value)} maxLength={50} required/></label>
    <label>{localText(dict, 'age')}<select value={age} onChange={event => setAge(Number(event.target.value))}>{[4, 5, 6, 7, 8, 9, 10, 11, 12].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>{localText(dict, 'condition')}<select value={condition} onChange={event => setCondition(event.target.value)}><option value="">{localText(dict, 'condition_none')}</option><option value="dcd">{localText(dict, 'condition_dcd')}</option><option value="adhd_motor">{localText(dict, 'condition_adhd')}</option><option value="asd_motor">{localText(dict, 'condition_asd')}</option><option value="fine_motor_delay">{localText(dict, 'condition_delay')}</option></select></label>
    <label>{localText(dict, 'hand')}<select value={hand} onChange={event => setHand(event.target.value)}><option value="left">{localText(dict, 'left')}</option><option value="right">{localText(dict, 'right')}</option><option value="both">{localText(dict, 'both')}</option></select></label>
    <label>{localText(dict, 'patient_language')}<select value={patientLanguage} onChange={event => setPatientLanguage(event.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
    <label className="consent-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required/>{localText(dict, 'consent')}</label>
    <div className="form-actions">{onCancel && <button type="button" className="button secondary" onClick={onCancel}>{localText(dict, 'cancel')}</button>}<button className="button primary" disabled={!consent}>{localText(dict, 'continue')}</button></div>
  </form>;
}
function LanguageSelect({ value, onChange, label }) {
    return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>{languages.map(item => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>;
}
export default function App() {
    if (import.meta.env.DEV && location.pathname === '/camera-bench')
        return <CameraBench />;
    const [language, setLanguage] = useState(detectLanguage()), [profile, setProfile] = useState(null), [group, setGroup] = useState(null);
    const [patients, setPatients] = useState([]), [route, setRoute] = useState('home'), [calibration, setCalibration] = useState([]), [cameraStatus, setCameraStatus] = useState('stopped');
    const [theme, setTheme] = useState('child'), [highContrast, setHighContrast] = useState(false), [voice, setVoice] = useState(true);
    const [apiKey, setApiKey] = useState(''), [online, setOnline] = useState(navigator.onLine), [pending, setPending] = useState(0), [installPrompt, setInstallPrompt] = useState(null);
    const [cloudReport, setCloudReport] = useState(null), [resources, setResources] = useState([]);
    const [aiConsent, setAiConsent] = useState(false), [analysisStatus, setAnalysisStatus] = useState('');
    const [difficultyProposal, setDifficultyProposal] = useState(null);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reminderTime, setReminderTime] = useState('18:00'), [notifyPermission, setNotifyPermission] = useState(() => typeof Notification === 'undefined' ? 'default' : Notification.permission);
    const dict = useMemo(() => dictionary(language), [language]);
    const clinic = group === 'clinic';
    const setLang = useCallback(async (next) => { setLanguage(next); localStorage.setItem('dexplay.language', next); await setSetting('language', next); }, []);
    useEffect(() => {
        const operation = startOperation('app.initialize');
        let live = true;
        void (async () => {
            try {
            const [savedLanguage, savedGroup, savedProfile, savedTheme, savedContrast, savedVoice, savedKey, savedCalibration, savedReminder] = await Promise.all([
                getSetting('language', detectLanguage()), getSetting('group', null), getSetting('current-profile', null),
                getSetting('theme', 'child'), getSetting('high-contrast', false), getSetting('voice', true),
                getSetting('api-key', ''), getSetting('calibration:default', []), getSetting('reminder-time', '18:00')
            ]);
            const dbPatients = await (await db()).getAll('patients');
            const storedResources = await (await db()).getAll('resource_cache');
            const profileConsent = savedProfile
                ? await getSetting(`ai-consent:${savedProfile.id}`, false)
                : false;
            if (!live) {
                operation.event('cancelled', { source: 'local' });
                return;
            }
            setLanguage(savedLanguage);
            localStorage.setItem('dexplay.language', savedLanguage);
            setGroup(savedGroup);
            setProfile(savedProfile);
            setPatients(dbPatients);
            setTheme(savedTheme);
            setHighContrast(savedContrast);
            setVoice(savedVoice);
            setApiKey(savedKey);
            setCalibration(savedCalibration);
            setReminderTime(savedReminder);
            setResources(storedResources);
            setAiConsent(profileConsent);
            if (savedProfile && savedGroup)
                setRoute('home');
            else
                setRoute('setup');
            setPending(await pendingSyncCount());
            operation.complete({ source: 'local' });
            } catch (err) {
                operation.fail(err, { source: 'local' });
                if (live)
                    setError('Unable to open local storage. Please enable site storage and reload.');
            }
        })();
        const onlineHandler = () => { setOnline(true); logOperationEvent('network', 'online'); };
        const offlineHandler = () => { setOnline(false); logOperationEvent('network', 'offline'); };
        const installHandler = (event) => { event.preventDefault(); setInstallPrompt(event); };
        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);
        window.addEventListener('beforeinstallprompt', installHandler);
        return () => { live = false; window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); window.removeEventListener('beforeinstallprompt', installHandler); };
    }, []);
    // PayPal redirects back only after approval. The claim token is one-time and removed from browser history after exchange.
    useEffect(() => {
        const token = new URLSearchParams(location.search).get('claim');
        if (!token)
            return;
        const operation = startOperation('paypal.activation_claim');
        let cancelled = false;
        void (async () => {
            try {
                for (let attempt = 0; attempt < 10; attempt++) {
                    const response = await fetch(`${API}/paypal/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': operation.requestId }, body: JSON.stringify({ activation_token: token }) });
                    if (response.status === 202) {
                        operation.event('pending', { attempt: attempt + 1, status_code: response.status });
                        await new Promise(resolve => setTimeout(resolve, 2500));
                        continue;
                    }
                    if (!response.ok) {
                        operation.event('rejected', { status_code: response.status });
                        throw new Error('The payment is not active yet. Please return later or contact support.');
                    }
                    const result = await response.json();
                    if (cancelled)
                        return;
                    const key = result.keys[0]?.api_key;
                    if (!key)
                        throw new Error('PayPal activated the plan but no device key was issued.');
                    await setSetting('api-key', key);
                    await setSetting('clinic-keys', result.keys);
                    setApiKey(key);
                    history.replaceState({}, document.title, location.pathname);
                    setNotice('Cloud access is active. Your access key is saved on this device.');
                    if (result.account_type === 'clinic')
                        setGroup('clinic');
                    operation.complete({ source: 'cloud', status_code: response.status });
                    return;
                }
                throw new Error('PayPal approval is still processing. Check Settings in a moment.');
            }
            catch (err) {
                operation.fail(err, { source: 'cloud' });
                if (!cancelled)
                    setError(err instanceof Error ? err.message : 'Could not activate the subscription.');
            }
        })();
        return () => { cancelled = true; };
    }, []);
    useEffect(() => { const message = (event) => { if (event.data?.type === 'dexplay-sync-complete')
        void pendingSyncCount().then(setPending); }; navigator.serviceWorker?.addEventListener('message', message); return () => navigator.serviceWorker?.removeEventListener('message', message); }, []);
    useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; document.documentElement.dataset.theme = theme; document.documentElement.dataset.contrast = highContrast ? 'high' : 'normal'; }, [language, theme, highContrast]);
    const storeProfile = useCallback(async (next) => {
        const operation = startOperation('profile.save');
        try {
        await (await db()).put('patients', next);
        await setSetting('current-profile', next);
        await setSetting('group', next.group);
        setAiConsent(false);
        setProfile(next);
        setGroup(next.group);
        setPatients(await (await db()).getAll('patients'));
        setRoute('calibrate');
        operation.complete({ source: 'local' });
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    }, []);
    const changePatient = async (next) => {
        const operation = startOperation('profile.switch');
        try {
            const consent = await getSetting(`ai-consent:${next.id}`, false);
            const savedCalibration = await getSetting(`calibration:${next.id}`, []);
            await setSetting('current-profile', next);
            setProfile(next);
            setAiConsent(consent);
            setCalibration(savedCalibration);
            setRoute('home');
            operation.complete({ source: 'local' });
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    };
    const onCalibration = async (points) => {
        const operation = startOperation('game.calibration_save');
        try {
            await setSetting('calibration:default', points);
            if (profile)
                await setSetting(`calibration:${profile.id}`, points);
            setCalibration(points);
            operation.complete({ source: 'local', item_count: points.length });
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    };
    const finishGame = async (session, _rounds, result) => {
        setCloudReport(null);
        const status = result?.analysis_status || 'Only local game measurements are available; no AI result was received.';
        const gaps = result?.resource_gaps || [];
        setAnalysisStatus(gaps.length ? `${status} Resource availability: ${gaps.join(' ')}` : status);
        setDifficultyProposal(result?.difficulty_proposal_available ? result.next_difficulty : null);
        if (result) {
            const reports = result.report;
            if (result.ai_generated && hasReportContent(reports)) {
                setCloudReport(reports);
                await setSetting(`report:${session.id}`, reports);
                if (apiKey)
                    await setSetting(await cloudSyncMarker(session.id, apiKey), true);
            }
            const delivered = result.new_resources;
            if (delivered?.length) {
                for (const item of delivered) {
                    try {
                        await saveResource(item, profile?.id ?? '');
                    }
                    catch (err) {
                        setError(err instanceof Error ? err.message : 'Resource download failed.');
                    }
                }
                ;
                setResources(await (await db()).getAll('resource_cache'));
            }
        }
        setPending(await pendingSyncCount());
        setRoute('reports');
    };
    const saveDifficultyChoice = async (difficulty) => {
        if (!profile)
            return;
        const operation = startOperation('difficulty.save_choice');
        try {
        const { rationale, ...settings } = difficulty;
        const revised = { ...profile, difficulty: settings };
        await (await db()).put('patients', revised);
        await setSetting('current-profile', revised);
        setProfile(revised);
        setDifficultyProposal(null);
        setNotice('Your selected game difficulty was saved for the next session.');
        operation.complete({ source: 'local' });
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    };
    const deleteLocalData = async () => {
        if (!window.confirm('Delete all DexPlay information stored on this device?'))
            return;
        const operation = startOperation('privacy.delete_local_data');
        try {
        const database = await db();
        database.close();
        await indexedDB.deleteDatabase('dexplay-production');
        for (const name of await caches.keys())
            if (name.startsWith('dexplay-'))
                await caches.delete(name);
        localStorage.removeItem('dexplay.language');
        setProfile(null);
        setPatients([]);
        setResources([]);
        setApiKey('');
        setGroup(null);
        setRoute('setup');
        operation.complete({ source: 'local' });
        location.reload();
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    };
    const nav = [['home', 'home', '⌂'], ['play', 'play', '✦'], ...(clinic ? [["patients", "patients", "♧"]] : []), ['reports', 'reports', '▤'], ['resources', 'resources', '◇'], ['settings', 'settings', '⚙']];
    if (route === 'setup')
        return <main className="setup-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}><header className="brand"><span className="brand-mark">D</span><span>DexPlay</span><LanguageSelect value={language} onChange={setLang} label={localText(dict, 'language')}/></header><SetupScreen language={language} dict={dict} currentGroup={group} onGroup={async (value) => { setGroup(value); await setSetting('group', value); }} onSave={storeProfile} patients={patients}/></main>;
    if (!profile)
        return <main className="setup-shell"><p>{localText(dict, 'welcome')}</p></main>;
    return <div className="app-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header className="topbar"><button className="brand brand-button" onClick={() => setRoute('home')}><span className="brand-mark">D</span><span>DexPlay</span></button>
      <div className="topbar-right"><span className={`network-pill ${online ? 'online' : 'offline'}`}><i aria-hidden="true"/>{localText(dict, online ? 'online' : 'offline')}</span><button className="avatar" onClick={() => setRoute('settings')} aria-label={profile.name}>{profile.name.slice(0, 1).toUpperCase()}</button></div>
    </header>
    <div className="app-layout"><nav className="side-nav" aria-label="Main navigation">{nav.map(([path, label, icon]) => <button key={path} className={route === path ? 'active' : ''} onClick={() => setRoute(path)}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{localText(dict, label)}</span></button>)}<div className="nav-spacer"/><a className="mat-link" href="/mat.svg" target="_blank" rel="noreferrer">▧ {localText(dict, 'mat')}</a></nav>
      <main className="content-area">
        {error && <div className="alert error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}{notice && <div className="alert success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
        {route === 'calibrate' && <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'camera')}</p><h1>{localText(dict, 'mat')}</h1><p>{localText(dict, 'camera_help')}</p><a className="button secondary" href="/mat.svg" target="_blank" rel="noreferrer">{localText(dict, 'mat')}</a></div><CameraCoach active clinic dict={dict} calibration={calibration} onCorner={onCalibration} onFrame={() => { }} onCameraStatus={setCameraStatus}/>{calibration.length === 4 && <button className="button primary large" disabled={cameraStatus !== 'ready'} onClick={() => setRoute('home')}>{localText(dict, 'calibrated')} · {localText(dict, 'continue')}</button>}</section>}
        {route === 'home' && <HomeScreen profile={profile} clinic={clinic} dict={dict} patients={patients} onPlay={() => setRoute('play')} onSettings={() => setRoute('settings')} onPrint={() => setRoute('reports')}/>}
        {route === 'play' && <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'play')}</p><h1>{profile.name}, {localText(dict, 'welcome')}</h1><p>{localText(dict, 'camera_privacy')}</p></div><GameSession profile={profile} clinic={clinic} voice={voice} dict={dict} calibration={calibration} onCalibration={onCalibration} apiKey={apiKey} aiConsent={aiConsent} onFinished={finishGame} onClose={() => setRoute('home')}/></section>}
        {route === 'patients' && clinic && <ClinicScreen profile={profile} patients={patients} dict={dict} onSwitch={changePatient} onAdd={() => setRoute('setup')} onPlay={() => setRoute('play')}/>}
        {route === 'reports' && <ReportsScreen profile={profile} clinic={clinic} dict={dict} cloudReport={cloudReport} analysisStatus={analysisStatus} difficultyProposal={difficultyProposal} onDifficultyAccept={saveDifficultyChoice} onDifficultyDecline={() => { setDifficultyProposal(null); setAnalysisStatus('Difficulty proposal declined. The saved game settings were not changed.'); }} apiKey={apiKey} onPrint={() => window.print()} onPlay={() => setRoute('play')} onSettings={() => setRoute('settings')}/>}
        {route === 'resources' && <ResourcesScreen resources={resources} profile={profile} dict={dict} onDelete={async (id) => { await removeResource(id); setResources(await (await db()).getAll('resource_cache')); }}/>}
        {route === 'resource-review' && <ResourceReviewScreen onBack={() => setRoute('settings')}/>}
        {route === 'settings' && <SettingsScreen language={language} profile={profile} clinic={clinic} dict={dict} theme={theme} highContrast={highContrast} voice={voice} aiConsent={aiConsent} onAiConsent={async (value) => { const operation = startOperation('privacy.ai_consent'); try { await setSetting(`ai-consent:${profile.id}`, value); setAiConsent(value); operation.complete({ enabled: value, source: 'local' }); } catch (err) { operation.fail(err, { source: 'local' }); throw err; } }} apiKey={apiKey} reminderTime={reminderTime} notifyPermission={notifyPermission} installPrompt={installPrompt} onResourceReview={() => setRoute('resource-review')} onLanguage={setLang} onProfileLanguage={async (value) => { const revised = { ...profile, language: value }; setProfile(revised); await (await db()).put('patients', revised); await setSetting('current-profile', revised); }} onTheme={async (value) => { setTheme(value); await setSetting('theme', value); }} onContrast={async (value) => { setHighContrast(value); await setSetting('high-contrast', value); }} onVoice={async (value) => { setVoice(value); await setSetting('voice', value); }} onApiKey={async (value) => { setApiKey(value); await setSetting('api-key', value); }} onReminder={async (value) => { setReminderTime(value); await setSetting('reminder-time', value); }} onPermission={setNotifyPermission} onDelete={deleteLocalData} onRefreshInstall={() => setInstallPrompt(null)} onResources={async () => setResources(await (await db()).getAll('resource_cache'))} onSyncComplete={async () => setPending(await pendingSyncCount())}/>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Main navigation">{nav.map(([path, label, icon]) => <button key={path} className={route === path ? 'active' : ''} onClick={() => setRoute(path)}><span aria-hidden="true">{icon}</span><small>{localText(dict, label)}</small></button>)}</nav>
    <footer className="app-footer"><span>{localText(dict, 'camera_privacy')}</span>{pending > 0 && <span>{pending} · {localText(dict, 'sync_pending')}</span>}</footer>
  </div>;
}
function SetupScreen({ language, dict, currentGroup, onGroup, onSave, patients }) {
    const [adding, setAdding] = useState(false);
    if (!currentGroup)
        return <section className="welcome-card"><div className="hero-illustration"><div className="hero-sun"/><div className="hero-hand">✋</div><span className="float-ball red"/><span className="float-ball blue"/><span className="float-ball green"/></div><p className="eyebrow">DEXTERITY COACH</p><h1>{localText(dict, 'welcome')}</h1><p>{localText(dict, 'tagline')}</p><h2>{localText(dict, 'choose_group')}</h2><div className="group-cards"><button className="group-card child-card" onClick={() => void onGroup('child')}><span>🧸</span><strong>{localText(dict, 'child')}</strong><small>4–12 years</small></button><button className="group-card clinic-card" onClick={() => void onGroup('clinic')}><span>🩺</span><strong>{localText(dict, 'clinic')}</strong><small>Shared device · roster · reports</small></button></div></section>;
    if (currentGroup === 'clinic' && patients.length && !adding)
        return <section className="welcome-card"><p className="eyebrow">{localText(dict, 'clinic')}</p><h1>{localText(dict, 'choose_group')}</h1><p>{localText(dict, 'active_patients')}: {patients.length}</p><div className="patient-list">{patients.map(patient => <button key={patient.id} className="patient-choice" onClick={() => onSave(patient)}><span className="avatar">{patient.name.slice(0, 1)}</span><span>{patient.name}</span><small>{patient.age_years}</small></button>)}</div><button className="button secondary" onClick={() => setAdding(true)}>{localText(dict, 'add_patient')}</button></section>;
    return <section className="welcome-card setup-form-wrap"><div className="setup-head"><p className="eyebrow">{localText(dict, currentGroup)}</p><h1>{localText(dict, 'child_name')}</h1><p>{localText(dict, 'camera_privacy')}</p></div><ProfileForm group={currentGroup} language={language} dict={dict} onSubmit={onSave} onCancel={currentGroup === 'clinic' && patients.length ? () => setAdding(false) : undefined}/></section>;
}
function HomeScreen({ profile, clinic, dict, patients, onPlay, onSettings, onPrint }) {
    const [sessions, setSessions] = useState([]);
    useEffect(() => { void recentSessions(clinic ? undefined : profile.id).then(setSessions); }, [clinic, profile.id]);
    const completed = sessions.length, last = sessions[0];
    return <section className="page home-page"><div className="welcome-banner"><div><p className="eyebrow">{clinic ? localText(dict, 'clinic') : localText(dict, 'child')}</p><h1>{clinic ? `${localText(dict, 'welcome')}` : `${profile.name}, ${localText(dict, 'welcome')}`}</h1><p>{localText(dict, 'tagline')}</p><button className="button primary large" onClick={onPlay}>{localText(dict, 'start')} <span aria-hidden="true">→</span></button></div><div className="banner-art" aria-hidden="true"><div className="rainbow">✋</div><span>●</span><span>●</span><span>●</span></div></div>
    <div className="stat-grid"><article className="stat-card"><span className="stat-emoji">⭐</span><small>{localText(dict, 'total_sessions')}</small><strong>{completed}</strong></article><article className="stat-card"><span className="stat-emoji">🔥</span><small>{localText(dict, 'streak')}</small><strong>{Math.min(completed, 7)}</strong></article><article className="stat-card"><span className="stat-emoji">🧩</span><small>{localText(dict, 'active_patients')}</small><strong>{clinic ? patients.length : 1}</strong></article></div>
    <div className="home-columns"><article className="panel"><div className="panel-heading"><h2>{localText(dict, 'recent_sessions')}</h2><button className="text-link" onClick={onPrint}>{localText(dict, 'reports')} →</button></div>{last ? <p>{new Date(last.started_at).toLocaleDateString(languageLocale(profile.language))} · {last.mode}</p> : <p>{localText(dict, 'session_saved')}</p>}<p className="muted">{localText(dict, 'camera_privacy')}</p></article><article className="panel mat-panel"><div><h2>{localText(dict, 'mat')}</h2><p>{localText(dict, 'mat_help')}</p><a href="/mat.svg" target="_blank" rel="noreferrer" className="button secondary">{localText(dict, 'continue')}</a></div><div className="mat-icon">▦</div></article></div>
    <button className="text-link settings-shortcut" onClick={onSettings}>{localText(dict, 'settings')} →</button>
  </section>;
}
function ClinicScreen({ profile, patients, dict, onSwitch, onAdd, onPlay }) {
    const [counts, setCounts] = useState({});
    useEffect(() => { void Promise.all(patients.map(async (patient) => [patient.id, (await recentSessions(patient.id, 1000)).length])).then(rows => setCounts(Object.fromEntries(rows))); }, [patients]);
    const queue = patients.filter(patient => (counts[patient.id] ?? 0) === 0);
    return <section className="page clinic-page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'clinic')}</p><h1>{localText(dict, 'patients')}</h1><p>{localText(dict, 'quick_switch')} · {patients.length}/50</p></div><div className="clinic-actions"><select aria-label={localText(dict, 'quick_switch')} value={profile.id} onChange={event => { const p = patients.find(item => item.id === event.target.value); if (p)
        onSwitch(p); }}>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select><button className="button primary" onClick={onAdd}>{localText(dict, 'add_patient')}</button><button className="button secondary" onClick={onPlay}>{localText(dict, 'start')}</button></div>
    <div className="stat-grid"><article className="stat-card"><span className="stat-emoji">🧒</span><small>{localText(dict, 'active_patients')}</small><strong>{patients.length}</strong></article><article className="stat-card"><span className="stat-emoji">🗓️</span><small>{localText(dict, 'queue')}</small><strong>{queue.length}</strong></article><article className="stat-card"><span className="stat-emoji">✦</span><small>{localText(dict, 'total_sessions')}</small><strong>{Object.values(counts).reduce((a, b) => a + b, 0)}</strong></article></div>
    <div className="patient-table panel"><div className="patient-row table-head"><span>{localText(dict, 'child_name')}</span><span>{localText(dict, 'age')}</span><span>{localText(dict, 'condition')}</span><span>{localText(dict, 'total_sessions')}</span><span>{localText(dict, 'last_practice')}</span></div>{patients.map(patient => <PatientRow key={patient.id} profile={patient} count={counts[patient.id] ?? 0} onClick={() => onSwitch(patient)}/>)}</div>
  </section>;
}
function PatientRow({ profile, count, onClick }) { const [last, setLast] = useState(null); useEffect(() => { void recentSessions(profile.id, 1).then(rows => setLast(rows[0] ?? null)); }, [profile.id, count]); return <button className="patient-row" onClick={onClick}><strong>{profile.name}</strong><span>{profile.age_years}</span><span>{profile.condition || '—'}</span><span>{count}</span><span>{last ? new Date(last.started_at).toLocaleDateString() : '—'}</span></button>; }
// function ReportsScreen({ profile, dict, cloudReport, analysisStatus, difficultyProposal, onDifficultyAccept, onDifficultyDecline, apiKey, onPrint, onPlay, onSettings }) {
//     const [sessions, setSessions] = useState([]), [rounds, setRounds] = useState([]);
//     useEffect(() => { void (async () => { const rows = await recentSessions(profile.id, 200); setSessions(rows); if (rows[0]) {
//         const all = await (await db()).getAllFromIndex('rounds', 'by-session', rows[0].id);
//         setRounds(all);
//         const saved = await getSetting(`report:${rows[0].id}`, null);
//         if (saved)
//             setCloudReportSafe(saved);
//     } })(); }, [profile.id]);
//     const [storedReport, setStoredReport] = useState(cloudReport);
//     const setCloudReportSafe = (value) => setStoredReport(value);
//     const hasReportContent = (report) => Boolean(report && ['parent', 'therapist', 'patient'].some(audience => report[audience]?.report_text));
//     const chosen = [cloudReport, storedReport].find(hasReportContent);
//     const hasReport = Boolean(chosen);
//     const average = rounds.length ? Math.round(rounds.reduce((sum, row) => sum + row.accuracy, 0) / rounds.length * 100) : 0;
//     const placed = rounds.reduce((sum, row) => sum + row.objects_placed, 0);
//     const total = rounds.reduce((sum, row) => sum + row.objects_total, 0);
//     const fumbles = rounds.reduce((sum, row) => sum + row.fumbles, 0);
//     const averageTime = rounds.length ? (rounds.reduce((sum, row) => sum + row.avg_time, 0) / rounds.length).toFixed(1) : '0.0';
//     return <section className="page report-page"><div className="page-heading report-intro"><p className="eyebrow">{localText(dict, 'reports')}</p><h1>{localText(dict, 'reports')}</h1><p>{profile.name} · {sessions.length} {localText(dict, 'total_sessions')}</p><button className="button primary" onClick={onPlay}>{localText(dict, 'start')}</button></div>
//     <article className="panel report-summary"><h2>Measured game results</h2><p>Recorded on this device from the completed color-sorting rounds.</p><div className="stat-grid report-metrics"><div className="stat-card report-metric"><small>Pieces placed</small><strong>{placed}/{total}</strong></div><div className="stat-card report-metric"><small>Round accuracy</small><strong>{average}%</strong></div><div className="stat-card report-metric"><small>Average seconds per piece</small><strong>{averageTime}</strong></div><div className="stat-card report-metric"><small>Misplacements</small><strong>{fumbles}</strong></div></div>{rounds.length > 0 && <div className="recent-list"><h3>Round details</h3>{rounds.map(row => <p className="report-round" key={row.id}>Round {row.round_num}: {row.objects_placed}/{row.objects_total} placed · {Math.round(row.accuracy * 100)}% · {row.avg_time}s per piece · {row.fumbles} misplacements</p>)}</div>}</article>
//     {analysisStatus && <p className="notice" role="status">{analysisStatus}</p>}
//     {difficultyProposal && <DifficultyProposal proposal={difficultyProposal} onAccept={onDifficultyAccept} onDecline={onDifficultyDecline}/>}
//     {hasReport ? <><div className="report-actions"><button className="button primary" onClick={onPrint}>{localText(dict, 'print')}</button></div><div className="print-report"><div className="report-title report-reveal"><h2>AI-generated DexPlay game feedback · {profile.name}</h2><p>Based on the measurements above. General activity feedback only—not diagnosis, therapy, or individualized clinical advice.</p></div>{chosen.parent?.report_text && <article className="report-copy report-reveal"><h3>{localText(dict, 'parent')}</h3><p>{chosen.parent.report_text}</p></article>}{chosen.therapist?.report_text && <article className="report-copy report-reveal"><h3>{localText(dict, 'therapist')}</h3><p>{chosen.therapist.report_text}</p></article>}{chosen.patient?.report_text && <article className="report-copy report-reveal"><h3>{localText(dict, 'patient')}</h3><p>{chosen.patient.report_text}</p></article>}</div></> : <article className="panel report-lock"><span className="lock-icon">{apiKey ? '☁' : '🔒'}</span><h2>AI report not available</h2><p>{analysisStatus || (apiKey ? 'Cloud reports are available after consented analysis and successful sync.' : 'AI reports require your separate, optional consent in Settings.')}</p><p>Your local measurements and session history remain available without cloud AI.</p>{apiKey && <button className="button secondary" onClick={onSettings}>{localText(dict, 'settings')}</button>}</article>}
//     <div className="panel recent-list report-recent"><h2>{localText(dict, 'recent_sessions')}</h2>{sessions.slice(0, 10).map(session => <div className="recent-row report-session-row" key={session.id}><span>{new Date(session.started_at).toLocaleString(languageLocale(profile.language))}</span><span>{session.mode}</span></div>)}</div>
//   </section>;
// }
function ReportsScreen({ profile, dict, cloudReport, analysisStatus, difficultyProposal, onDifficultyAccept, onDifficultyDecline, apiKey, onPrint, onPlay, onSettings }) {
    const [sessions, setSessions] = useState([]), [rounds, setRounds] = useState([]);
    useEffect(() => { void (async () => { const rows = await recentSessions(profile.id, 200); setSessions(rows); if (rows[0]) {
        const all = await (await db()).getAllFromIndex('rounds', 'by-session', rows[0].id);
        setRounds(all);
        const saved = await getSetting(`report:${rows[0].id}`, null);
        if (saved)
            setCloudReportSafe(saved);
    } })(); }, [profile.id]);
    const [storedReport, setStoredReport] = useState(cloudReport);
    const setCloudReportSafe = (value) => setStoredReport(value);
    const hasReportContent = (report) => Boolean(report && ['parent', 'therapist', 'patient'].some(audience => report[audience]?.report_text));
    const chosen = [cloudReport, storedReport].find(hasReportContent);
    const hasReport = Boolean(chosen);
    const average = rounds.length ? Math.round(rounds.reduce((sum, row) => sum + row.accuracy, 0) / rounds.length * 100) : 0;
    const placed = rounds.reduce((sum, row) => sum + row.objects_placed, 0);
    const total = rounds.reduce((sum, row) => sum + row.objects_total, 0);
    const fumbles = rounds.reduce((sum, row) => sum + row.fumbles, 0);
    const averageTime = rounds.length ? (rounds.reduce((sum, row) => sum + row.avg_time, 0) / rounds.length).toFixed(1) : '0.0';

    return (
    <section className="page report-page dex-reports-container">
        
        {/* Playful Header */}
        <div className="page-heading report-intro dex-header">
            <p className="eyebrow">{localText(dict, 'reports')} 🏆</p>
            <h1 className="dex-float">{localText(dict, 'reports')}</h1>
            <p>{profile.name} · {sessions.length} {localText(dict, 'total_sessions')} 🌟</p>
            <button className="button primary dex-bounce-btn" onClick={onPlay}>{localText(dict, 'start')} ▶️</button>
        </div>

        {/* Fun Stats Cards */}
        <article className="panel report-summary dex-panel">
            <h2>🎮 Your Awesome Game Results</h2>
            <p>Look at what you did on this device during the color-sorting game!</p>
            
            <div className="stat-grid report-metrics dex-stat-grid">
                <div className="stat-card report-metric dex-pop" style={{ animationDelay: '0.1s', backgroundColor: '#ffe0b2' }}>
                    <small>🧩 <span className="dex-term" data-tech="Objects Placed">Pieces placed</span></small>
                    <strong>{placed}/{total}</strong>
                </div>
                <div className="stat-card report-metric dex-pop" style={{ animationDelay: '0.2s', backgroundColor: '#c8e6c9' }}>
                    <small>🎯 <span className="dex-term" data-tech="Round Accuracy">Round accuracy</span></small>
                    <strong>{average}%</strong>
                </div>
                <div className="stat-card report-metric dex-pop" style={{ animationDelay: '0.3s', backgroundColor: '#d1c4e9' }}>
                    <small>⏱️ <span className="dex-term" data-tech="Average Seconds per Piece">Seconds per piece</span></small>
                    <strong>{averageTime}s</strong>
                </div>
                <div className="stat-card report-metric dex-pop" style={{ animationDelay: '0.4s', backgroundColor: '#ffcdd2' }}>
                    <small>🤪 <span className="dex-term" data-tech="Misplacements (Fumbles)">Oopsie Drops</span></small>
                    <strong>{fumbles}</strong>
                </div>
            </div>

            {rounds.length > 0 && (
                <div className="recent-list dex-round-details">
                    <h3>📝 Round Details</h3>
                    {rounds.map((row, index) => {
                        const accPercent = Math.round(row.accuracy * 100);
                        return (
                            <div className="dex-round-row dex-fade-up" style={{ animationDelay: `${0.5 + (index * 0.1)}s` }} key={row.id}>
                                <span className="dex-round-num">Round {row.round_num}</span>
                                <div className="dex-progress-bar-container">
                                    <div className="dex-progress-bar" style={{ width: `${accPercent}%`, backgroundColor: accPercent > 70 ? '#2e7d32' : accPercent > 40 ? '#e65100' : '#c62828' }}></div>
                                </div>
                                <span className="dex-round-text">{row.objects_placed}/{row.objects_total} placed · {accPercent}% · {row.avg_time}s per piece · {row.fumbles} drops</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </article>

        {analysisStatus && <p className="notice dex-notice" role="status">✨ {analysisStatus}</p>}
        {difficultyProposal && <DifficultyProposal proposal={difficultyProposal} onAccept={onDifficultyAccept} onDecline={onDifficultyDecline}/>}

        {/* AI Reports Section */}
        {hasReport ? (
            <>
                <div className="report-actions">
                    <button className="button primary dex-print-btn" onClick={onPrint}>🖨️ {localText(dict, 'print')}</button>
                </div>
                <div className="print-report dex-print-report">
                    <div className="report-title report-reveal dex-fade-up">
                        <h2>🪄 AI Magic Feedback for {profile.name}</h2>
                        <p className="dex-disclaimer">Based on the measurements above. General activity feedback only—not diagnosis, therapy, or individualized clinical advice.</p>
                    </div>
                    
                    {chosen.parent?.report_text && (
                        <article className="report-copy report-reveal dex-fade-up dex-card-parent" style={{ animationDelay: '0.2s' }}>
                            <h3>👨🏿‍👩🏿‍👧🏿 {localText(dict, 'parent')}</h3>
                            <p>{chosen.parent.report_text}</p>
                        </article>
                    )}
                    {chosen.therapist?.report_text && (
                        <article className="report-copy report-reveal dex-fade-up dex-card-therapist" style={{ animationDelay: '0.4s' }}>
                            <h3>🧑🏿‍⚕️ {localText(dict, 'therapist')}</h3>
                            <p>{chosen.therapist.report_text}</p>
                        </article>
                    )}
                    {chosen.patient?.report_text && (
                        <article className="report-copy report-reveal dex-fade-up dex-card-patient" style={{ animationDelay: '0.6s' }}>
                            <h3>🧒🏿 {localText(dict, 'patient')}</h3>
                            <p>{chosen.patient.report_text}</p>
                        </article>
                    )}
                </div>
            </>
        ) : (
            <article className="panel report-lock dex-lock-panel dex-fade-up">
                <span className="lock-icon dex-float">{apiKey ? '☁️' : '🔒'}</span>
                <h2>AI Magic Not Available Yet</h2>
                <p>{analysisStatus || (apiKey ? 'Cloud reports are available after consented analysis and successful sync.' : 'AI reports require your separate, optional consent in Settings.')}</p>
                <p>But don't worry! Your local measurements and session history are still safe and sound here.</p>
                {apiKey && <button className="button secondary" onClick={onSettings}>{localText(dict, 'settings')} ⚙️</button>}
            </article>
        )}

        {/* Recent Sessions */}
        <div className="panel recent-list report-recent dex-fade-up">
            <h2>📅 {localText(dict, 'recent_sessions')}</h2>
            {sessions.slice(0, 10).map((session, index) => (
                <div className="recent-row report-session-row dex-session-row" key={session.id} style={{ animationDelay: `${index * 0.05}s` }}>
                    <span>🕒 {new Date(session.started_at).toLocaleString(languageLocale(profile.language))}</span>
                    <span className="dex-badge">{session.mode}</span>
                </div>
            ))}
        </div>

        {/* --- ANIMATION & TOOLTIP STYLES --- */}
        <style>{`
            .dex-reports-container {
                font-family: 'Nunito', 'Segoe UI', sans-serif;
                color: #3e2723; /* Warmer dark brown text for readability on warm backgrounds */
            }
            .dex-header h1 {
                color: #4e342e;
                font-size: 2.5rem;
                margin-bottom: 0.5rem;
            }
            .dex-panel {
                border-radius: 20px;
                box-shadow: 0 8px 20px rgba(78, 52, 46, 0.08);
                border: 2px solid #ffcc80;
                background: #fffaf5;
            }
            
            /* --- TOOLTIP STYLING --- */
            .dex-term {
                position: relative;
                cursor: help;
                border-bottom: 2px dotted #795548;
                color: inherit;
            }
            .dex-term::after {
                content: attr(data-tech);
                position: absolute;
                bottom: 120%;
                left: 50%;
                transform: translateX(-50%) translateY(10px);
                background-color: #4e342e;
                color: #fff;
                text-align: center;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 0.8rem;
                font-weight: normal;
                white-space: nowrap;
                opacity: 0;
                visibility: hidden;
                transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                z-index: 10;
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            }
            .dex-term::before {
                content: '';
                position: absolute;
                bottom: 100%;
                left: 50%;
                margin-left: -6px;
                border-width: 6px;
                border-style: solid;
                border-color: #4e342e transparent transparent transparent;
                opacity: 0;
                visibility: hidden;
                transition: all 0.2s;
                z-index: 10;
            }
            .dex-term:hover::after {
                opacity: 1;
                visibility: visible;
                transform: translateX(-50%) translateY(0);
            }
            .dex-term:hover::before {
                opacity: 1;
                visibility: visible;
            }

            /* Stat Cards */
            .dex-stat-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
                margin-top: 20px;
            }
            .dex-stat-card {
                border-radius: 16px;
                padding: 15px;
                text-align: center;
                border: 2px solid rgba(0,0,0,0.05);
                transition: transform 0.2s ease;
                box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            }
            .dex-stat-card:hover {
                transform: scale(1.05) rotate(2deg);
            }
            .dex-stat-card strong {
                font-size: 1.8rem;
                color: #3e2723;
                display: block;
                margin-top: 5px;
            }
            
            /* Round Details */
            .dex-round-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px;
                background: #fdf3e7;
                border-radius: 10px;
                margin-bottom: 8px;
                flex-wrap: wrap;
            }
            .dex-round-num { font-weight: bold; min-width: 60px; color: #4e342e; }
            .dex-progress-bar-container {
                flex-grow: 1;
                background: #e0d6cf;
                height: 12px;
                border-radius: 6px;
                overflow: hidden;
                min-width: 100px;
            }
            .dex-progress-bar { height: 100%; border-radius: 6px; transition: width 1s ease-in-out; }
            .dex-round-text { font-size: 0.9em; color: #5d4037; }

            /* AI Cards - Warm African-inspired tones */
            .dex-card-parent { background: #fff8e1; border-left: 8px solid #f9a825; padding: 15px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 4px 8px rgba(249,168,37,0.1); }
            .dex-card-therapist { background: #e8f5e9; border-left: 8px solid #2e7d32; padding: 15px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 4px 8px rgba(46,125,50,0.1); }
            .dex-card-patient { background: #fbe9e7; border-left: 8px solid #d84315; padding: 15px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 4px 8px rgba(216,67,21,0.1); }
            .dex-card-parent h3, .dex-card-therapist h3, .dex-card-patient h3 { margin-top: 0; }
            
            .dex-print-btn {
                background-color: #e65100 !important;
                color: white;
                border-radius: 20px;
                font-weight: bold;
                transition: all 0.2s ease;
            }
            .dex-print-btn:hover {
                background-color: #bf360c !important;
                transform: scale(1.05);
            }

            .dex-badge {
                background: #ffcc80;
                color: #4e342e;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.8rem;
                font-weight: bold;
            }
            .dex-session-row { transition: background 0.2s; border-radius: 8px; }
            .dex-session-row:hover { background: #fdf3e7; }

            /* Animations */
            .dex-pop { animation: dexPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both; }
            @keyframes dexPop {
                0% { transform: scale(0.8); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
            .dex-fade-up { animation: dexFadeUp 0.6s ease-out both; }
            @keyframes dexFadeUp {
                0% { transform: translateY(20px); opacity: 0; }
                100% { transform: translateY(0); opacity: 1; }
            }
            .dex-float { animation: dexFloat 3s ease-in-out infinite; }
            @keyframes dexFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-8px); }
            }
            .dex-bounce-btn { border-radius: 20px; animation: dexBounce 2s infinite; }
            @keyframes dexBounce {
                0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
                40% { transform: translateY(-5px); }
                60% { transform: translateY(-3px); }
            }
        `}</style>
    </section>
    );
}
function DifficultyProposal({ proposal, onAccept, onDecline }) {
    const [draft, setDraft] = useState({ ...proposal });
    const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
    const valid = Number.isInteger(draft.object_size_mm) && draft.object_size_mm >= 12 && draft.object_size_mm <= 60 &&
        Number.isInteger(draft.time_limit_s) && draft.time_limit_s >= 20 && draft.time_limit_s <= 600 &&
        Number.isInteger(draft.objects_count) && draft.objects_count >= 1 && draft.objects_count <= 30;
    return <article className="panel difficulty-proposal"><h2>AI difficulty proposal</h2><p>{proposal.rationale || 'The assistant suggests these settings for a future game.'}</p><p>Review and choose: accept it, adjust it, or decline it. It will not be applied until you confirm.</p><div className="difficulty-fields">
      <label>Object size (mm)<input type="number" min="12" max="60" value={draft.object_size_mm ?? 22} onChange={event => update('object_size_mm', Number(event.target.value))}/></label>
      <label>Time limit (seconds)<input type="number" min="20" max="600" value={draft.time_limit_s ?? 60} onChange={event => update('time_limit_s', Number(event.target.value))}/></label>
      <label>Objects per round<input type="number" min="1" max="30" value={draft.objects_count ?? 5} onChange={event => update('objects_count', Number(event.target.value))}/></label>
    </div><div className="form-actions"><button className="button secondary" onClick={onDecline}>Decline</button><button className="button primary" disabled={!valid} onClick={() => onAccept(draft)}>Accept selected settings</button></div><p className="muted">A general game-setting suggestion—not clinical advice.</p></article>;
}
function ResourcesScreen({ resources, profile, dict, onDelete }) {
    const [openUrl, setOpenUrl] = useState('');
    const [published, setPublished] = useState([]);
    const [catalogError, setCatalogError] = useState('');
    useEffect(() => {
      let active = true;
      const operation = startOperation('resource.catalog_load');
      void fetch(`${API}/resources?age_group=${encodeURIComponent(profile.age_group)}&language=${encodeURIComponent(profile.language)}`).then(async response => {
        if (!response.ok) {
          operation.event('rejected', { source: 'cloud', status_code: response.status });
          throw new Error(`Resource catalog unavailable (${response.status}).`);
        }
        return response.json();
      }).then(data => {
        if (active) {
          setPublished(data.resources || []);
          setCatalogError('');
          operation.complete({ source: 'cloud', item_count: data.resources?.length ?? 0 });
        }
      }).catch(reason => {
        operation.fail(reason, { source: 'cloud' });
        if (active) {
          setPublished([]);
          setCatalogError(reason instanceof Error ? reason.message : 'Published resources could not be loaded.');
        }
      });
      return () => { active = false; };
    }, [profile.age_group, profile.language]);
    const allResources = [...published, ...resources.filter(item => !published.some(entry => entry.id === item.id))];
    return <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'resources')}</p><h1>{localText(dict, 'resources')}</h1><p>Reviewed links and locally saved catalog files. External links are not clinical validation.</p></div>{catalogError && <p className="notice" role="status">{catalogError}</p>}{allResources.length === 0 ? <article className="panel empty-state"><div>◇</div><h2>{localText(dict, 'no_resources')}</h2><p>There are currently no published resources matching this broad age band.</p></article> : <div className="resource-grid">{allResources.map(item => <article className="resource-card" key={item.id}><span className="resource-type">{item.externally_sourced ? 'EXTERNAL WEB RESOURCE' : item.type.toUpperCase()} · {(item.language || 'en').toUpperCase()}</span><h2>{item.title}</h2>{item.externally_sourced ? <><p>Source: {item.source}</p><p>Access: {item.access_status}; license: {item.license}</p><p>Age range: {item.age_range}</p><p>Mat activity relevance: {item.mat_relevance}</p><p>Safety notes: {item.safety_notes}</p><p>Review notes: {item.review_notes || 'None recorded'}</p><p>Discovered: {item.discovered_at ? new Date(item.discovered_at).toLocaleDateString() : 'Not recorded'} · Link checked: {item.verified_at ? new Date(item.verified_at).toLocaleDateString() : 'Not verified'} ({item.link_status || 'status unknown'})</p><p>Reviewed by {item.reviewer_role || 'designated reviewer'} on {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString() : 'date unavailable'}.</p><p>{item.clinic_recommended ? `Clinic-approved for this PoC. Evidence: ${item.clinic_approval_evidence}` : 'Externally sourced; not clinic-recommended.'} This link is not clinically validated.</p><a className="button secondary" href={item.url} target="_blank" rel="noopener noreferrer">Open external resource</a></> : <><p>{item.license || ''}</p><p>{item.clinic_recommended ? `Clinic-approved for this PoC. Evidence: ${item.clinic_approval_evidence}` : 'Catalog resource; not clinic-recommended.'}</p>{resources.some(row => row.id === item.id) ? <div className="resource-actions"><button className="button secondary" onClick={() => setOpenUrl(openUrl === item.id ? '' : item.id)}>{localText(dict, 'continue')}</button><button className="text-link danger-link" onClick={() => onDelete(item.id)}>{localText(dict, 'delete')}</button></div> : <a className="button secondary" href={item.url} target="_blank" rel="noopener noreferrer">Open catalog resource</a>}{openUrl === item.id && <ResourcePreview item={item}/>}</>}</article>)}</div>}</section>;
}
function ResourcePreview({ item }) { const [url, setUrl] = useState(''); useEffect(() => { let objectUrl = ''; void caches.open('dexplay-resources').then(cache => cache.match(item.url)).then(async (response) => { if (response) {
    objectUrl = URL.createObjectURL(await response.blob());
    setUrl(objectUrl);
} }); return () => { if (objectUrl)
    URL.revokeObjectURL(objectUrl); }; }, [item.url]); if (!url)
    return <p>Offline file could not be opened. Re-download it while online.</p>; return item.type === 'video' ? <video controls playsInline src={url} className="resource-player"/> : <iframe title={item.title} src={url} className="resource-document"/>; }
function ResourceReviewScreen({ onBack }) {
    const [token, setToken] = useState('');
    const [candidates, setCandidates] = useState([]);
    const [published, setPublished] = useState([]);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const request = async (path, method = 'GET', body) => {
        const action = path.endsWith('/discover') ? 'discover'
            : path.endsWith('/approve') ? 'approve'
            : path.endsWith('/reject') ? 'reject'
            : path.endsWith('/published') ? 'load_published'
            : 'load_candidates';
        const operation = startOperation(`resource.reviewer_${action}`);
        try {
            const response = await fetch(`${API}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Request-ID': operation.requestId,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                operation.event('rejected', { source: 'reviewer', status_code: response.status });
                throw new Error(data.detail || `Reviewer request failed (${response.status}).`);
            }
            operation.complete({
                source: 'reviewer',
                status_code: response.status,
                item_count: data.candidates?.length ?? data.resources?.length ?? data.added?.length,
            });
            return data;
        } catch (err) {
            operation.fail(err, { source: 'reviewer' });
            throw err;
        }
    };
    const loadQueue = async () => {
        if (!token.trim()) {
            setError('Enter the reviewer credential supplied by the deployment administrator.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const [queue, catalog] = await Promise.all([
                request('/review/resources/candidates'),
                request('/review/resources/published'),
            ]);
            setCandidates(queue.candidates || []);
            setPublished(catalog.resources || []);
            setStatus('Reviewer access verified. Pending items are visible only in this protected workflow.');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not load the review queue.');
        } finally {
            setBusy(false);
        }
    };
    const discover = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await request('/review/resources/discover', 'POST');
            const discoveryStatus = `Discovery checked the approved OT Toolbox RSS feed; ${result.added.length} candidate(s) added. Daily requests: ${result.daily_requests_used}/${result.daily_request_limit}. Physio-Pedia status: deferred because its public sitemap returned 403; it was not fetched.`;
            await loadQueue();
            setStatus(discoveryStatus);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Approved-source discovery failed.');
        } finally {
            setBusy(false);
        }
    };
    const review = async (id, action, body) => {
        setBusy(true);
        setError('');
        try {
            await request(`/review/resources/candidates/${encodeURIComponent(id)}/${action}`, 'POST', body);
            await loadQueue();
            setStatus(action === 'approve' ? 'Resource published after explicit human approval.' : 'Candidate rejected and retained in the review history.');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Review action failed.');
        } finally {
            setBusy(false);
        }
    };
    return <section className="page settings-page"><div className="page-heading"><p className="eyebrow">Protected workflow</p><h1>Resource review queue</h1><p>Only the designated DexPlay content reviewer can discover candidates or publish them. Candidates are never shown to users before approval.</p><button className="button secondary" onClick={onBack}>Back to Settings</button></div>
      <article className="panel settings-section"><h2>Reviewer access</h2><p>The deployment administrator configures the server-only RESOURCE_REVIEWER_TOKEN. Enter it here for this page session; it is not saved in browser storage or sent to logs.</p><label>Reviewer credential<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)}/></label><div className="form-actions"><button className="button secondary" disabled={busy || !token} onClick={() => void loadQueue()}>Load review queue</button><button className="button primary" disabled={busy || !token} onClick={() => void discover()}>Discover from approved feeds</button></div>{status && <p className="notice" role="status">{status}</p>}{error && <p className="error-text" role="alert">{error}</p>}</article>
      <article className="panel"><h2>Allowed sources</h2><p>The OT Toolbox: public RSS feed; checked only when the reviewer starts discovery.</p><p>Physio-Pedia: approved hostname, but automated discovery is deferred because its public sitemap returned HTTP 403. No restricted endpoint is accessed.</p><p>Discovery is capped at 10 feed requests per UTC day. Link checks do not follow redirects. License and public-access status require reviewer confirmation.</p></article>
      <h2>Pending candidates ({candidates.length})</h2>{candidates.map(item => <ReviewCandidateCard key={item.id} item={item} disabled={busy} onReview={review}/>)}{!candidates.length && <p>No pending candidates are available.</p>}
      <h2>Published resources ({published.length})</h2>{published.map(item => <article className="panel" key={item.id}><h3>{item.title}</h3><p>{item.source} · <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a></p><p>Discovered {new Date(item.discovered_at).toLocaleString()} · link checked {item.verified_at ? new Date(item.verified_at).toLocaleString() : 'not verified'} ({item.link_status})</p><p>Access: {item.access_status}; license: {item.license_info}; age range: {item.age_range}</p><p>Mat relevance: {item.mat_relevance}</p><p>Safety notes: {item.safety_notes}</p><p>Review notes: {item.review_notes || 'None'}</p><p>{item.clinic_approved ? `Clinic-approved globally for this PoC. Evidence: ${item.clinic_approval_evidence}` : 'Externally sourced; not clinic-recommended.'}</p><p>Reviewed by {item.reviewer_role} on {item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : 'unknown date'}.</p></article>)}
    </section>;
}
function ReviewCandidateCard({ item, disabled, onReview }) {
    const [form, setForm] = useState({
        access_status: 'unknown',
        license_info: 'Unknown; reviewer must check source terms.',
        age_range: '',
        mat_relevance: '',
        safety_notes: '',
        review_notes: '',
        link_verified: item.link_status === 'HTTP 200',
        clinic_approved: false,
        clinic_approval_evidence: '',
    });
    const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
    return <article className="panel review-candidate"><p className="notice">Candidate only — not approved or visible to users.</p><h3>{item.title}</h3><p>Source/publisher: {item.source}</p><p><a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a></p><p>Discovered: {new Date(item.discovered_at).toLocaleString()} · Link check: {item.verified_at ? new Date(item.verified_at).toLocaleString() : 'not checked'} · {item.link_status}</p>
      <label>Access status<select value={form.access_status} onChange={event => change('access_status', event.target.value)}><option value="unknown">Unknown / not reviewed</option><option value="free_public">Free and publicly accessible</option><option value="account_required">Account required</option><option value="paid">Paid</option></select></label>
      <label>License/copyright information<input value={form.license_info} onChange={event => change('license_info', event.target.value)}/></label>
      <label>Intended age range<input value={form.age_range} onChange={event => change('age_range', event.target.value)} placeholder="e.g. 4-12 or all ages"/></label>
      <label>Mat-activity relevance<textarea value={form.mat_relevance} onChange={event => change('mat_relevance', event.target.value)}/></label>
      <label>Safety/review notes<textarea value={form.safety_notes} onChange={event => change('safety_notes', event.target.value)}/></label>
      {item.link_status !== 'HTTP 200' && <label className="consent-check"><input type="checkbox" checked={form.link_verified} onChange={event => change('link_verified', event.target.checked)}/>I manually checked that this link resolves to the reviewed resource</label>}
      <label>Reviewer notes (required if link check is inconclusive)<textarea value={form.review_notes} onChange={event => change('review_notes', event.target.value)}/></label>
      <label className="consent-check"><input type="checkbox" checked={form.clinic_approved} onChange={event => change('clinic_approved', event.target.checked)}/>A clinic explicitly approved this resource for global use in this PoC</label>
      {form.clinic_approved && <label>Clinic approval evidence<textarea value={form.clinic_approval_evidence} onChange={event => change('clinic_approval_evidence', event.target.value)} placeholder="Record the explicit clinic approval and its source."/></label>}
      <p className="muted">Publishing requires a free/public access review, age range, mat relevance, safety notes, and license status. Unknown license status must remain explicit. If the link cannot be verified, the published record will show its inconclusive status and review notes.</p>
      <div className="form-actions"><button className="button secondary" disabled={disabled} onClick={() => onReview(item.id, 'reject')}>Reject</button><button className="button primary" disabled={disabled || form.access_status !== 'free_public' || !form.age_range.trim() || !form.mat_relevance.trim() || !form.safety_notes.trim() || !form.license_info.trim() || (item.link_status !== 'HTTP 200' && !form.review_notes.trim()) || (form.clinic_approved && !form.clinic_approval_evidence.trim())} onClick={() => onReview(item.id, 'approve', form)}>Approve and publish</button></div>
    </article>;
}
function SettingsScreen({ language, profile, clinic, dict, theme, highContrast, voice, aiConsent, onAiConsent, apiKey, reminderTime, notifyPermission, installPrompt, onResourceReview, onLanguage, onProfileLanguage, onTheme, onContrast, onVoice, onApiKey, onReminder, onPermission, onDelete, onRefreshInstall, onResources, onSyncComplete }) {
    const [keyInput, setKeyInput] = useState(''), [scan, setScan] = useState(false), [phone, setPhone] = useState(''), [smsConsent, setSmsConsent] = useState(false), [activationError, setActivationError] = useState(''), [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine);
    const [syncMessage, setSyncMessage] = useState(''), [syncError, setSyncError] = useState(false);
    const [clinicKeys, setClinicKeys] = useState([]), [paypalConfig, setPaypalConfig] = useState(null), [paypalConfigError, setPaypalConfigError] = useState('');
    useEffect(() => { void getSetting('clinic-keys', []).then(setClinicKeys); const on = () => setOnline(navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
    useEffect(() => {
        let cancelled = false;
        void fetch(`${API}/paypal/config`).then(async (response) => {
            if (!response.ok)
                throw new Error(`Payment environment check failed (${response.status}).`);
            return response.json();
        }).then((config) => {
            if (!cancelled)
                setPaypalConfig(config);
        }).catch((err) => {
            if (!cancelled)
                setPaypalConfigError(err instanceof Error ? err.message : 'Payment environment could not be checked.');
        });
        return () => { cancelled = true; };
    }, []);
    const activate = async (event) => {
        event.preventDefault();
        const operation = startOperation('device_key.activate');
        setActivationError('');
        setBusy(true);
        try {
            const response = await fetch(`${API}/keys/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Request-ID': operation.requestId },
                body: JSON.stringify({ api_key: keyInput, device_label: clinic ? 'clinic-tablet' : profile.name }),
            });
            if (!response.ok) {
                operation.event('rejected', { source: 'cloud', status_code: response.status });
                throw new Error(localText(dict, 'key_invalid'));
            }
            await onApiKey(keyInput);
            setKeyInput('');
            operation.complete({ source: 'cloud', status_code: response.status });
        } catch (err) {
            operation.fail(err, { source: 'cloud' });
            setActivationError(err instanceof Error ? err.message : localText(dict, 'key_invalid'));
        } finally {
            setBusy(false);
        }
    };
    const subscribe = async (plan) => {
        const operation = startOperation('paypal.checkout');
        setActivationError('');
        setBusy(true);
        try {
        const response = await fetch(`${API}/paypal/create_subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': operation.requestId }, body: JSON.stringify({ plan, language, sms_consent: smsConsent, phone_number: smsConsent ? phone || undefined : undefined }) });
        if (!response.ok) {
            operation.event('rejected', { source: 'cloud', status_code: response.status });
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || 'Could not create a secure PayPal checkout.');
        }
        const data = await response.json();
        operation.complete({ source: 'cloud', status_code: response.status });
        window.location.assign(data.approval_url);
        } catch (err) {
        operation.fail(err, { source: 'cloud' });
        setActivationError(err instanceof Error ? err.message : 'PayPal is temporarily unavailable.');
        } finally {
        setBusy(false);
        }
    };
    const scanQr = async () => {
        const operation = startOperation('device_key.qr_scan');
        setActivationError('');
        try {
        const Barcode = window.BarcodeDetector;
        if (!Barcode)
            throw new Error('QR scanning is not supported by this browser. Type the key instead.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        setScan(true);
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const detector = new Barcode({ formats: ['qr_code'] });
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const results = await detector.detect(video);
            if (results[0]?.rawValue) {
                setKeyInput(results[0].rawValue.trim().slice(-12));
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        stream.getTracks().forEach((track) => track.stop());
        setScan(false);
        operation.complete({ source: 'local' });
        } catch (err) {
        operation.fail(err, { source: 'local' });
        setActivationError(err instanceof Error ? err.message : 'QR scan failed.');
        } finally {
        setScan(false);
        }
    };
    const enableNotify = async () => { if (!('Notification' in window)) {
        setActivationError('Notifications are not supported by this browser.');
        return;
    } const permission = await Notification.requestPermission(); onPermission(permission); };
    const syncNow = async () => { if (!apiKey) {
        setActivationError(localText(dict, 'report_locked'));
        return;
    } setBusy(true); setSyncMessage('Syncing saved sessions…'); setSyncError(false); try {
        const database = await db();
        const keyFingerprint = await cloudKeyFingerprint(apiKey);
        const queue = await database.getAll('sync_queue');
        let syncedCount = 0, reportCount = 0, aiSkippedCount = 0, resourceFailureCount = 0, resourceGapCount = 0;
        const reportFailures = new Set();
        const attemptedSessionIds = new Set();
        const requestSync = async (payload, source) => {
            const requestId = crypto.randomUUID();
            const started = performance.now();
            console.info('[DexPlay sync] request_started', {
                request_id: requestId,
                source,
                rounds: payload.session_data?.length ?? 0,
            });
            let response;
            try {
                response = await fetch(`${API}/sync`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Device-Key': apiKey,
                        'X-Request-ID': requestId,
                    },
                    body: JSON.stringify(payload),
                });
            }
            catch (err) {
                console.error('[DexPlay sync] network_failed', {
                    request_id: requestId,
                    source,
                    error_type: err instanceof Error ? err.name : 'UnknownError',
                    elapsed_ms: Math.round(performance.now() - started),
                });
                throw err;
            }
            const serverRequestId = response.headers.get('X-Request-ID') || requestId;
            console.info('[DexPlay sync] response_received', {
                request_id: serverRequestId,
                source,
                status: response.status,
                elapsed_ms: Math.round(performance.now() - started),
            });
            return { response, requestId: serverRequestId };
        };
        const saveResponse = async (response, sessionId, profileId, requestId) => {
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                console.error('[DexPlay sync] response_rejected', {
                    request_id: requestId,
                    status: response.status,
                });
                throw new Error(body.detail || `Session sync failed (${response.status}).`);
            }
            let data;
            try {
                data = await response.json();
            }
            catch (err) {
                console.error('[DexPlay sync] invalid_response_body', {
                    request_id: requestId,
                    status: response.status,
                    error_type: err instanceof Error ? err.name : 'UnknownError',
                });
                throw err;
            }
            const expectedAudiences = ['parent', 'therapist', 'patient'];
            const generatedAudiences = expectedAudiences
                .filter(audience => data.report?.[audience]?.report_text);
            const hasReport = generatedAudiences.length > 0;
            const completeReport = generatedAudiences.length === expectedAudiences.length;
            resourceGapCount += (data.resource_gaps || []).length;
            console.info('[DexPlay sync] analysis_result', {
                request_id: requestId,
                report_audiences: generatedAudiences,
                missing_audiences: expectedAudiences.filter(audience => !generatedAudiences.includes(audience)),
                agents_unavailable: data.agents_unavailable || [],
                partial: Boolean(data.partial),
            });
            if (hasReport) {
                await setSetting(`report:${sessionId}`, data.report);
            }
            if (completeReport) {
                reportCount++;
            } else if (data.ai_skipped) {
                aiSkippedCount++;
            } else {
                const unavailable = (data.agents_unavailable || [])
                    .filter(agent => agent === 'adaptive' || agent === 'reports' || agent.startsWith('report_'));
                const missingAudiences = expectedAudiences
                    .filter(audience => !generatedAudiences.includes(audience))
                    .map(audience => `report_${audience}`);
                for (const agent of new Set([...unavailable, ...missingAudiences]))
                    reportFailures.add(agent);
            }
            for (const item of data.new_resources || []) {
                try {
                    await saveResource(item, profileId);
                }
                catch (err) {
                    console.error('[DexPlay sync] resource_download_failed', {
                        request_id: requestId,
                        error_type: err instanceof Error ? err.name : 'UnknownError',
                    });
                    resourceFailureCount++;
                }
            }
            if (completeReport)
                await setSetting(`cloud-synced:${keyFingerprint}:${sessionId}`, true);
            attemptedSessionIds.add(sessionId);
        };
        console.info('[DexPlay sync] started', {
            queued_sessions: queue.filter(item => !item.synced).length,
            has_active_key: Boolean(apiKey),
            online: navigator.onLine,
        });
        for (const row of queue.filter(item => !item.synced)) {
            const queuedProfileId = row.profile_id || row.payload.patient_id || profile.id;
            const currentlyConsented = await getSetting(`ai-consent:${queuedProfileId}`, false);
            const queuedPayload = {
                ...row.payload,
                ai_consent: Boolean(row.payload.ai_consent && currentlyConsented),
            };
            const request = await requestSync(queuedPayload, 'offline_queue');
            const sessionId = queuedPayload.session_data?.at(-1)?.session_id;
            await saveResponse(request.response, sessionId || row.id, queuedProfileId, request.requestId);
            await database.delete('sync_queue', row.id);
            syncedCount++;
        }

        const allSessions = (await database.getAll('sessions'))
            .filter(session => session.ended_at && (clinic || session.profile_id === profile.id))
            .sort((a, b) => a.started_at.localeCompare(b.started_at));
        const allPatients = clinic ? await database.getAll('patients') : [profile];
        console.info('[DexPlay sync] local_sessions_loaded', {
            completed_sessions: allSessions.length,
            patient_profiles: allPatients.length,
        });
        let skippedCount = 0, skippedFromBackfillCount = 0;
        for (const session of allSessions) {
            if (attemptedSessionIds.has(session.id)) {
                skippedFromBackfillCount++;
                continue;
            }
            if (await getSetting(`cloud-synced:${keyFingerprint}:${session.id}`, false)) {
                skippedFromBackfillCount++;
                continue;
            }
            const sessionProfile = allPatients.find(item => item.id === session.profile_id);
            if (!sessionProfile) {
                console.error('[DexPlay sync] profile_missing_for_session', {
                    profile_count: allPatients.length,
                });
                throw new Error('A saved session has no matching local profile. No more sessions were synced.');
            }
            const rounds = (await database.getAllFromIndex('rounds', 'by-session', session.id))
                .sort((a, b) => a.round_num - b.round_num);
            if (!rounds.length) {
                skippedCount++;
                console.warn('[DexPlay sync] completed_session_has_no_rounds');
                continue;
            }
            const profileAiConsent = await getSetting(`ai-consent:${sessionProfile.id}`, false);
            const payload = {
                session_data: rounds.map(round => ({ ...round, session_id: session.id })),
                profile: {
                    group: clinic ? 'clinic' : 'child',
                    age_group: sessionProfile.age_group,
                    language: sessionProfile.language,
                    difficulty: session.difficulty_params || sessionProfile.difficulty,
                },
                ai_consent: profileAiConsent,
                subscription_state: 'active',
                usage_stats: {
                    free_sessions_count: allSessions.length,
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
                patient_id: clinic ? sessionProfile.id : undefined,
            };
            const request = await requestSync(payload, 'local_history');
            await saveResponse(request.response, session.id, sessionProfile.id, request.requestId);
            syncedCount++;
        }
        await onSyncComplete();
        await onResources();
        const reportErrorCount = syncedCount - reportCount - aiSkippedCount;
        const message = syncedCount
            ? reportErrorCount === 0 && aiSkippedCount === 0
                ? `${syncedCount} session${syncedCount === 1 ? '' : 's'} synced. Cloud reports are saved on this device.`
                : reportErrorCount > 0
                    ? `${syncedCount} session${syncedCount === 1 ? '' : 's'} uploaded; ${reportErrorCount} report${reportErrorCount === 1 ? '' : 's'} could not be generated${reportFailures.size ? ` (${[...reportFailures].join(', ')} unavailable)` : ''}.`
                    : `${syncedCount} session${syncedCount === 1 ? '' : 's'} uploaded.`
            : skippedCount
                ? `No unsynced sessions found. ${skippedCount} completed session${skippedCount === 1 ? '' : 's'} had no saved round data.`
                : 'No sessions needed syncing.';
        const consentMessage = aiSkippedCount
            ? ` AI analysis was not requested for ${aiSkippedCount} session${aiSkippedCount === 1 ? '' : 's'} because consent was off.`
            : '';
        const resourceGapMessage = resourceGapCount
            ? ` No matching reviewed resources were available for ${resourceGapCount} session${resourceGapCount === 1 ? '' : 's'}.`
            : '';
        setSyncMessage(`${message}${consentMessage}${resourceGapMessage}${resourceFailureCount
            ? ` ${resourceFailureCount} resource download${resourceFailureCount === 1 ? '' : 's'} failed.`
            : ''}`);
        console.info('[DexPlay sync] completed', {
            uploaded_sessions: syncedCount,
            complete_reports: reportCount,
            report_failures: [...reportFailures],
            sessions_without_rounds: skippedCount,
            skipped_from_backfill: skippedFromBackfillCount,
            resource_download_failures: resourceFailureCount,
        });
    }
    catch (err) {
        setSyncError(true);
        setSyncMessage(err instanceof Error ? err.message : 'Sync failed.');
        console.error('[DexPlay sync] failed', {
            error_type: err instanceof Error ? err.name : 'UnknownError',
        });
    }
    finally {
        setBusy(false);
    } };
    const exportData = async () => { const database = await db(); const result = { profile, patients: await database.getAll('patients'), sessions: await database.getAll('sessions'), rounds: await database.getAll('rounds'), created_at: new Date().toISOString() }; const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'dexplay-export.json'; a.click(); URL.revokeObjectURL(url); };
    const deleteCloud = async () => { if (!apiKey)
        return; if (!confirm('Delete all encrypted cloud sessions and revoke this account key?'))
        return; const response = await fetch(`${API}/privacy/account`, { method: 'DELETE', headers: { 'X-Device-Key': apiKey } }); if (!response.ok) {
        setActivationError('Cloud data could not be deleted.');
        return;
    } await onApiKey(''); setActivationError('Cloud account and its encrypted session records were deleted.'); };
    const install = async () => { if (!installPrompt)
        return; await installPrompt.prompt(); await installPrompt.userChoice; onRefreshInstall(); };
    return <section className="page settings-page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'settings')}</p><h1>{localText(dict, 'settings')}</h1><p>{localText(dict, 'camera_privacy')}</p></div>
    <article className="panel settings-section"><h2>{localText(dict, 'language')}</h2><LanguageSelect value={language} onChange={onLanguage} label={localText(dict, 'therapist_language')}/><LanguageSelect value={profile.language} onChange={onProfileLanguage} label={localText(dict, 'patient_language')}/></article>
    <article className="panel settings-section"><h2>Optional AI analysis consent · {profile.name}</h2><p>{aiConsentDescription(language)} Current provider: OpenAI.</p><label className="switch-row"><span>{aiConsent ? 'AI analysis enabled for this profile' : 'AI analysis off'}</span><input type="checkbox" checked={aiConsent} onChange={event => onAiConsent(event.target.checked)}/></label></article>
    <article className="panel settings-section"><h2>{localText(dict, 'theme')}</h2><label>{localText(dict, 'theme')}<select value={theme} onChange={event => onTheme(event.target.value)}><option value="child">{localText(dict, 'theme_child')}</option><option value="clinical">{localText(dict, 'theme_clinical')}</option><option value="senior">{localText(dict, 'theme_senior')}</option></select></label><label className="switch-row"><span>{localText(dict, 'high_contrast')}</span><input type="checkbox" checked={highContrast} onChange={event => onContrast(event.target.checked)}/></label><label className="switch-row"><span>{localText(dict, 'voice')}</span><input type="checkbox" checked={voice} onChange={event => onVoice(event.target.checked)}/></label></article>
    <article className="panel settings-section"><h2>{localText(dict, 'activate_key')}</h2>{apiKey ? <p className="success-text">✓ {localText(dict, 'key_active')}</p> : <form className="key-form" onSubmit={activate}><label>{localText(dict, 'key_placeholder')}<input value={keyInput} onChange={event => setKeyInput(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 12))} minLength={12} maxLength={12} autoComplete="off"/></label><button className="button primary" disabled={busy || keyInput.length !== 12}>{busy ? localText(dict, 'continue') : localText(dict, 'activate')}</button><button type="button" className="button secondary" onClick={() => void scanQr()} disabled={busy}>{scan ? 'Scanning…' : 'Scan QR'}</button></form>}{clinicKeys.length > 1 && <details><summary>Clinic patient access keys</summary>{clinicKeys.map(item => <div key={item.label} className="key-row"><span>{item.label}</span><code>{item.api_key}</code></div>)}</details>}{activationError && <p className="error-text" role="alert">{activationError}</p>}</article>
    <article className="panel settings-section"><h2>{localText(dict, 'subscription')}</h2><p>{localText(dict, 'report_locked')}</p>{paypalConfig ? <p className={`notice payment-mode ${paypalConfig.mode === 'sandbox' ? 'sandbox' : 'live'}`}><strong>{paypalConfig.mode === 'sandbox' ? 'SANDBOX — test transactions only; no real charges.' : 'LIVE — real payments.'}</strong>{!paypalConfig.enabled && ' Payments are not configured on this server.'}</p> : <p className="notice" role={paypalConfigError ? 'alert' : undefined}>{paypalConfigError || 'Checking payment environment…'}</p>}<label>{localText(dict, 'child_name')}<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="+254…"/></label><label className="consent-check"><input type="checkbox" checked={smsConsent} onChange={event => setSmsConsent(event.target.checked)}/>{localText(dict, 'sms_optin')}</label><div className="plan-buttons"><button className="button secondary" disabled={busy || !online} onClick={() => void subscribe('individual')}>{localText(dict, 'individual_plan')}</button><button className="button primary" disabled={busy || !online} onClick={() => void subscribe('clinic')}>{localText(dict, 'clinic_plan')}</button></div>{!online && <p className="muted">Payment requires an internet connection.</p>}</article>
    <article className="panel settings-section"><h2>{localText(dict, 'sync')}</h2><label>{localText(dict, 'queue')}<input type="time" value={reminderTime} onChange={event => onReminder(event.target.value)}/></label><button className="button secondary" onClick={() => void enableNotify()}>{notifyPermission === 'granted' ? 'Notifications enabled' : 'Enable daily reminders'}</button><p className="muted">Daily reminders can appear while this app is open. Push reminders require an active cloud account. Sync stores encrypted session history; AI analysis runs only for profiles with separate AI consent.</p><button className="button primary" disabled={busy || !online || !apiKey} onClick={() => void syncNow()}>{busy ? 'Syncing…' : localText(dict, 'sync')}</button>{syncMessage && <p className={syncError ? 'error-text' : 'success-text'} role={syncError ? 'alert' : 'status'}>{syncMessage}</p>}<div className="settings-inline"><button className="text-link" onClick={() => void exportData()}>{localText(dict, 'export')}</button><button className="text-link" onClick={() => window.print()}>{localText(dict, 'print')}</button><button className="text-link" onClick={onResourceReview}>Open resource reviewer workflow</button></div>{apiKey && <button className="text-link danger-link" onClick={() => void deleteCloud()}>{localText(dict, 'delete_data')}</button>}</article>
    <article className="panel settings-section"><h2>DexPlay</h2><p>{localText(dict, 'offline')}</p><button className="button secondary" onClick={() => void install()} disabled={!installPrompt}>{installPrompt ? 'Install app' : 'Already installed or install unavailable'}</button><button className="text-link danger-link" onClick={() => void onDelete()}>{localText(dict, 'delete_data')} · this device</button></article>
  </section>;
}
async function cloudKeyFingerprint(apiKey) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function hasReportContent(report) {
    return Boolean(report && ['parent', 'therapist', 'patient'].some(audience => report[audience]?.report_text));
}
async function cloudSyncMarker(sessionId, apiKey) {
    return `cloud-synced:${await cloudKeyFingerprint(apiKey)}:${sessionId}`;
}
function languageLocale(lang) { return { en: 'en-US', es: 'es-ES', hi: 'hi-IN', zh: 'zh-CN', ar: 'ar', sw: 'sw-KE', pt: 'pt-BR', fr: 'fr-FR', bn: 'bn-BD', tl: 'fil-PH' }[lang] ?? 'en-US'; }
async function downloadResource(item, profileMatch) {
    const response = await fetch(item.url, { mode: 'cors', credentials: 'omit', redirect: 'error' });
    if (!response.ok || response.type === 'opaque')
        throw new Error(`Resource download failed: ${item.title}`);
    const maxBytes = Math.min(50 * 1024 * 1024, Math.max(item.size_mb * 1024 * 1024 + 1024, 1 * 1024 * 1024));
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('Resource has no readable response body');
    const chunks = [];
    let bytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            await reader.cancel();
            throw new Error('Resource exceeds its approved download size.');
        }
        chunks.push(value);
    }
    const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? (item.type === 'pdf' ? 'application/pdf' : 'application/octet-stream') });
    if (item.sha256) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
        if (actual.toLowerCase() !== item.sha256.toLowerCase())
            throw new Error('Resource checksum verification failed.');
    }
    const cache = await caches.open('dexplay-resources');
    await cache.put(item.url, new Response(blob, { headers: { 'Content-Type': blob.type } }));
    const metadata = { id: item.id, title: item.title, type: item.type, url: item.url, size_mb: Number((bytes / 1024 / 1024).toFixed(2)), downloaded_at: new Date().toISOString(), profile_match: profileMatch, language: item.language, sha256: item.sha256, license: item.license, externally_sourced: false, clinic_recommended: item.clinic_recommended, clinic_approval_evidence: item.clinic_approval_evidence };
    await (await db()).put('resource_cache', metadata);
}
async function saveResource(item, profileMatch) {
    const operation = startOperation('resource.save');
    try {
        if (!item.externally_sourced) {
            await downloadResource(item, profileMatch);
        } else {
            const metadata = {
                id: item.id,
                title: item.title,
                type: 'guide',
                url: item.url,
                size_mb: 0,
                downloaded_at: new Date().toISOString(),
                profile_match: profileMatch,
                language: item.language || 'en',
                externally_sourced: true,
                source: item.source,
                license: item.license,
                access_status: item.access_status,
                age_range: item.age_range,
                mat_relevance: item.mat_relevance,
                safety_notes: item.safety_notes,
                review_notes: item.review_notes,
                reviewer_role: item.reviewer_role,
                reviewed_at: item.reviewed_at,
                clinic_approval_evidence: item.clinic_approval_evidence,
                discovered_at: item.discovered_at,
                verified_at: item.verified_at,
                link_status: item.link_status,
                clinic_recommended: item.clinic_recommended,
            };
            await (await db()).put('resource_cache', metadata);
        }
        operation.complete({ source: 'local' });
    } catch (err) {
        operation.fail(err, { source: 'local' });
        throw err;
    }
}
async function removeResource(id) {
    const operation = startOperation('resource.remove');
    try {
        const database = await db(), resource = await database.get('resource_cache', id);
        if (resource) {
            const cache = await caches.open('dexplay-resources');
            await cache.delete(resource.url);
            await database.delete('resource_cache', id);
        }
        operation.complete({ source: 'local' });
    } catch (err) {
        operation.fail(err, { source: 'local' });
        throw err;
    }
}
// @ts-nocheck
