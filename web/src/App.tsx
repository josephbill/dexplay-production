// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, getSetting, pendingSyncCount, recentSessions, setSetting } from './db';
import { I18nProvider, languages, detectLanguage, dictionary, t, useI18n } from './i18n';
import { aiConsentDescription } from './i18n/aiConsent';
import { logOperationEvent, startOperation } from './operationLog';
import { GameSession } from './components/GameSession';
import { ReportsScreen } from './components/ReportsScreen';
import { CameraCoach } from './cv/CameraCoach';
import { CameraBench } from './components/CameraBench';
const API = import.meta.env.VITE_API_URL || '/api';
function makeProfile(group, name, age, condition, hand, language) {
    return { id: crypto.randomUUID(), group, name: name.trim(), age_years: age, age_group: age <= 6 ? '4-6' : age <= 9 ? '7-9' : '10-12', condition, hand, language, created_at: new Date().toISOString(), difficulty: { object_size_mm: 22, time_limit_s: 75, objects_count: 5, zone_size_mm: 80, speed_factor: 1 } };
}
function localText(dict, key, values = {}) { return t(dict, key, values); }
function ProfileForm({ group, language, onSubmit, onCancel }) {
    const { dict } = useI18n();
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
    const [aiConsent, setAiConsent] = useState(false), [analysisStatus, setAnalysisStatus] = useState(null);
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
                    setError('app_storage_error');
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
                        throw new Error('subscription_activation_error');
                    }
                    const result = await response.json();
                    if (cancelled)
                        return;
                    const key = result.keys[0]?.api_key;
                    if (!key)
                        throw new Error('subscription_activation_error');
                    await setSetting('api-key', key);
                    await setSetting('clinic-keys', result.keys);
                    setApiKey(key);
                    history.replaceState({}, document.title, location.pathname);
                    setNotice('cloud_key_saved_notice');
                    if (result.account_type === 'clinic')
                        setGroup('clinic');
                    operation.complete({ source: 'cloud', status_code: response.status });
                    return;
                }
                throw new Error('subscription_activation_error');
            }
            catch (err) {
                operation.fail(err, { source: 'cloud' });
                if (!cancelled)
                    setError('subscription_activation_error');
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
        const gaps = result?.resource_gaps || [];
        const statusKey = result?.ai_skipped
            ? 'analysis_not_requested'
            : result?.partial
                ? 'analysis_partial'
                : result?.ai_generated
                    ? 'analysis_completed'
                    : 'analysis_unavailable';
        setAnalysisStatus(gaps.length
            ? { key: 'resource_availability_count', values: { count: gaps.length } }
            : { key: statusKey });
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
                        setError('resource_download_error');
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
        setNotice('difficulty_saved_notice');
        operation.complete({ source: 'local' });
        } catch (err) {
            operation.fail(err, { source: 'local' });
            throw err;
        }
    };
    const deleteLocalData = async () => {
        if (!window.confirm(localText(dict, 'delete_local_confirmation')))
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
        return <I18nProvider language={language}><main className="setup-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}><header className="brand"><span className="brand-mark">D</span><span>DexPlay</span><LanguageSelect value={language} onChange={setLang} label={localText(dict, 'language')}/></header><SetupScreen currentGroup={group} onGroup={async (value) => { setGroup(value); await setSetting('group', value); }} onSave={storeProfile} patients={patients}/></main></I18nProvider>;
    if (!profile)
        return <I18nProvider language={language}><main className="setup-shell"><p>{localText(dict, 'welcome')}</p></main></I18nProvider>;
    return <I18nProvider language={language}><div className="app-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header className="topbar"><button className="brand brand-button" onClick={() => setRoute('home')}><span className="brand-mark">D</span><span>DexPlay</span></button>
      <div className="topbar-right"><span className={`network-pill ${online ? 'online' : 'offline'}`}><i aria-hidden="true"/>{localText(dict, online ? 'online' : 'offline')}</span><button className="avatar" onClick={() => setRoute('settings')} aria-label={profile.name}>{profile.name.slice(0, 1).toUpperCase()}</button></div>
    </header>
    <div className="app-layout"><nav className="side-nav" aria-label={localText(dict, 'main_navigation')}>{nav.map(([path, label, icon]) => <button key={path} className={route === path ? 'active' : ''} onClick={() => setRoute(path)}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{localText(dict, label)}</span></button>)}<div className="nav-spacer"/><a className="mat-link" href="/mat.svg" target="_blank" rel="noreferrer">▧ {localText(dict, 'mat')}</a></nav>
      <main className="content-area">
        {error && <div className="alert error" role="alert"><span>{localText(dict, error)}</span><button onClick={() => setError('')} aria-label={localText(dict, 'dismiss')}>×</button></div>}{notice && <div className="alert success" role="status"><span>{localText(dict, notice)}</span><button onClick={() => setNotice('')} aria-label={localText(dict, 'dismiss')}>×</button></div>}
        {route === 'calibrate' && <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'camera')}</p><h1>{localText(dict, 'mat')}</h1><p>{localText(dict, 'camera_help')}</p><a className="button secondary" href="/mat.svg" target="_blank" rel="noreferrer">{localText(dict, 'mat')}</a></div><CameraCoach active clinic dict={dict} calibration={calibration} onCorner={onCalibration} onFrame={() => { }} onCameraStatus={setCameraStatus}/>{calibration.length === 4 && <button className="button primary large" disabled={cameraStatus !== 'ready'} onClick={() => setRoute('home')}>{localText(dict, 'calibrated')} · {localText(dict, 'continue')}</button>}</section>}
        {route === 'home' && <HomeScreen profile={profile} clinic={clinic} patients={patients} onPlay={() => setRoute('play')} onSettings={() => setRoute('settings')} onPrint={() => setRoute('reports')}/>}
        {route === 'play' && <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'play')}</p><h1>{profile.name}, {localText(dict, 'welcome')}</h1><p>{localText(dict, 'camera_privacy')}</p></div><GameSession profile={profile} clinic={clinic} voice={voice} dict={dict} calibration={calibration} onCalibration={onCalibration} apiKey={apiKey} aiConsent={aiConsent} onFinished={finishGame} onClose={() => setRoute('home')}/></section>}
        {route === 'patients' && clinic && <ClinicScreen profile={profile} patients={patients} onSwitch={changePatient} onAdd={() => setRoute('setup')} onPlay={() => setRoute('play')}/>}
        {route === 'reports' && <ReportsScreen profile={profile} cloudReport={cloudReport} analysisStatus={analysisStatus} difficultyProposal={difficultyProposal} onDifficultyAccept={saveDifficultyChoice} onDifficultyDecline={() => { setDifficultyProposal(null); setAnalysisStatus({ key: 'difficulty_declined_notice' }); }} apiKey={apiKey} aiConsent={aiConsent} online={online} onPrint={() => window.print()} onPlay={() => setRoute('play')} onSettings={() => setRoute('settings')}/>}
        {route === 'resources' && <ResourcesScreen resources={resources} profile={profile} onDelete={async (id) => { await removeResource(id); setResources(await (await db()).getAll('resource_cache')); }}/>}
        {route === 'resource-review' && <ResourceReviewScreen onBack={() => setRoute('settings')}/>}
        {route === 'settings' && <SettingsScreen profile={profile} clinic={clinic} theme={theme} highContrast={highContrast} voice={voice} aiConsent={aiConsent} onAiConsent={async (value) => { const operation = startOperation('privacy.ai_consent'); try { await setSetting(`ai-consent:${profile.id}`, value); setAiConsent(value); operation.complete({ enabled: value, source: 'local' }); } catch (err) { operation.fail(err, { source: 'local' }); throw err; } }} apiKey={apiKey} reminderTime={reminderTime} notifyPermission={notifyPermission} installPrompt={installPrompt} onResourceReview={() => setRoute('resource-review')} onLanguage={setLang} onProfileLanguage={async (value) => { const revised = { ...profile, language: value }; setProfile(revised); await (await db()).put('patients', revised); await setSetting('current-profile', revised); }} onTheme={async (value) => { setTheme(value); await setSetting('theme', value); }} onContrast={async (value) => { setHighContrast(value); await setSetting('high-contrast', value); }} onVoice={async (value) => { setVoice(value); await setSetting('voice', value); }} onApiKey={async (value) => { setApiKey(value); await setSetting('api-key', value); }} onReminder={async (value) => { setReminderTime(value); await setSetting('reminder-time', value); }} onPermission={setNotifyPermission} onDelete={deleteLocalData} onRefreshInstall={() => setInstallPrompt(null)} onResources={async () => setResources(await (await db()).getAll('resource_cache'))} onSyncComplete={async () => setPending(await pendingSyncCount())}/>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label={localText(dict, 'main_navigation')}>{nav.map(([path, label, icon]) => <button key={path} className={route === path ? 'active' : ''} onClick={() => setRoute(path)}><span aria-hidden="true">{icon}</span><small>{localText(dict, label)}</small></button>)}</nav>
    <footer className="app-footer"><span>{localText(dict, 'camera_privacy')}</span>{pending > 0 && <span>{pending} · {localText(dict, 'sync_pending')}</span>}</footer>
  </div></I18nProvider>;
}
function SetupScreen({ currentGroup, onGroup, onSave, patients }) {
    const { dict, language } = useI18n();
    const [adding, setAdding] = useState(false);
    if (!currentGroup)
        return <section className="welcome-card"><div className="hero-illustration"><div className="hero-sun"/><div className="hero-hand">✋</div><span className="float-ball red"/><span className="float-ball blue"/><span className="float-ball green"/></div><p className="eyebrow">{localText(dict, 'brand_tagline')}</p><h1>{localText(dict, 'welcome')}</h1><p>{localText(dict, 'tagline')}</p><h2>{localText(dict, 'choose_group')}</h2><div className="group-cards"><button className="group-card child-card" onClick={() => void onGroup('child')}><span>🧸</span><strong>{localText(dict, 'child')}</strong><small>{localText(dict, 'child_age_range')}</small></button><button className="group-card clinic-card" onClick={() => void onGroup('clinic')}><span>🩺</span><strong>{localText(dict, 'clinic')}</strong><small>{localText(dict, 'shared_device_roster_reports')}</small></button></div></section>;
    if (currentGroup === 'clinic' && patients.length && !adding)
        return <section className="welcome-card"><p className="eyebrow">{localText(dict, 'clinic')}</p><h1>{localText(dict, 'choose_group')}</h1><p>{localText(dict, 'active_patients')}: {patients.length}</p><div className="patient-list">{patients.map(patient => <button key={patient.id} className="patient-choice" onClick={() => onSave(patient)}><span className="avatar">{patient.name.slice(0, 1)}</span><span>{patient.name}</span><small>{patient.age_years}</small></button>)}</div><button className="button secondary" onClick={() => setAdding(true)}>{localText(dict, 'add_patient')}</button></section>;
    return <section className="welcome-card setup-form-wrap"><div className="setup-head"><p className="eyebrow">{localText(dict, currentGroup)}</p><h1>{localText(dict, 'child_name')}</h1><p>{localText(dict, 'camera_privacy')}</p></div><br/><ProfileForm group={currentGroup} language={language} onSubmit={onSave} onCancel={currentGroup === 'clinic' && patients.length ? () => setAdding(false) : undefined}/></section>;
}
function HomeScreen({ profile, clinic, patients, onPlay, onSettings, onPrint }) {
    const { dict, language } = useI18n();
    const [sessions, setSessions] = useState([]);
    useEffect(() => { void recentSessions(clinic ? undefined : profile.id).then(setSessions); }, [clinic, profile.id]);
    const completed = sessions.length, last = sessions[0];
    return <section className="page home-page"><div className="welcome-banner"><div><p className="eyebrow">{clinic ? localText(dict, 'clinic') : localText(dict, 'child')}</p><h1>{clinic ? `${localText(dict, 'welcome')}` : `${profile.name}, ${localText(dict, 'welcome')}`}</h1><p>{localText(dict, 'tagline')}</p><button className="button primary large" onClick={onPlay}>{localText(dict, 'start')} <span aria-hidden="true">→</span></button></div><div className="banner-art" aria-hidden="true"><div className="rainbow">✋</div><span>●</span><span>●</span><span>●</span></div></div>
    <div className="stat-grid"><article className="stat-card"><span className="stat-emoji">⭐</span><small>{localText(dict, 'total_sessions')}</small><strong>{completed}</strong></article><article className="stat-card"><span className="stat-emoji">🔥</span><small>{localText(dict, 'streak')}</small><strong>{Math.min(completed, 7)}</strong></article><article className="stat-card"><span className="stat-emoji">🧩</span><small>{localText(dict, 'active_patients')}</small><strong>{clinic ? patients.length : 1}</strong></article></div>
    <div className="home-columns"><article className="panel"><div className="panel-heading"><h2>{localText(dict, 'recent_sessions')}</h2><button className="text-link" onClick={onPrint}>{localText(dict, 'reports')} →</button></div>{last ? <p>{new Date(last.started_at).toLocaleDateString(languageLocale(language))} · {localText(dict, last.mode)}</p> : <p>{localText(dict, 'session_saved')}</p>}<p className="muted">{localText(dict, 'camera_privacy')}</p></article><article className="panel mat-panel"><div><h2>{localText(dict, 'mat')}</h2><p>{localText(dict, 'mat_help')}</p><a href="/mat.svg" target="_blank" rel="noreferrer" className="button secondary">{localText(dict, 'continue')}</a></div><div className="mat-icon">▦</div></article></div>
    <button className="text-link settings-shortcut" onClick={onSettings}>{localText(dict, 'settings')} →</button>
  </section>;
}
function ClinicScreen({ profile, patients, onSwitch, onAdd, onPlay }) {
    const { dict, language } = useI18n();
    const [counts, setCounts] = useState({});
    useEffect(() => { void Promise.all(patients.map(async (patient) => [patient.id, (await recentSessions(patient.id, 1000)).length])).then(rows => setCounts(Object.fromEntries(rows))); }, [patients]);
    const queue = patients.filter(patient => (counts[patient.id] ?? 0) === 0);
    return <section className="page clinic-page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'clinic')}</p><h1>{localText(dict, 'patients')}</h1><p>{localText(dict, 'quick_switch')} · {patients.length}/50</p></div><div className="clinic-actions"><select aria-label={localText(dict, 'quick_switch')} value={profile.id} onChange={event => { const p = patients.find(item => item.id === event.target.value); if (p)
        onSwitch(p); }}>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select><button className="button primary" onClick={onAdd}>{localText(dict, 'add_patient')}</button><button className="button secondary" onClick={onPlay}>{localText(dict, 'start')}</button></div>
    <div className="stat-grid"><article className="stat-card"><span className="stat-emoji">🧒</span><small>{localText(dict, 'active_patients')}</small><strong>{patients.length}</strong></article><article className="stat-card"><span className="stat-emoji">🗓️</span><small>{localText(dict, 'queue')}</small><strong>{queue.length}</strong></article><article className="stat-card"><span className="stat-emoji">✦</span><small>{localText(dict, 'total_sessions')}</small><strong>{Object.values(counts).reduce((a, b) => a + b, 0)}</strong></article></div>
    <div className="patient-table panel"><div className="patient-row table-head"><span>{localText(dict, 'child_name')}</span><span>{localText(dict, 'age')}</span><span>{localText(dict, 'condition')}</span><span>{localText(dict, 'total_sessions')}</span><span>{localText(dict, 'last_practice')}</span></div>{patients.map(patient => <PatientRow key={patient.id} profile={patient} count={counts[patient.id] ?? 0} language={language} dict={dict} onClick={() => onSwitch(patient)}/>)}</div>
  </section>;
}
function PatientRow({ profile, count, language, dict, onClick }) { const [last, setLast] = useState(null); useEffect(() => { void recentSessions(profile.id, 1).then(rows => setLast(rows[0] ?? null)); }, [profile.id, count]); const conditionKey = { dcd: 'condition_dcd', adhd_motor: 'condition_adhd', asd_motor: 'condition_asd', fine_motor_delay: 'condition_delay' }[profile.condition]; return <button className="patient-row" onClick={onClick}><strong>{profile.name}</strong><span data-label={localText(dict, 'age')}>{profile.age_years}</span><span data-label={localText(dict, 'condition')}>{conditionKey ? localText(dict, conditionKey) : '—'}</span><span data-label={localText(dict, 'total_sessions')}>{count}</span><span data-label={localText(dict, 'last_practice')}>{last ? new Date(last.started_at).toLocaleDateString(languageLocale(language)) : '—'}</span></button>; }
function ResourcesScreen({ resources, profile, onDelete }) {
    const { dict, language } = useI18n();
    const [openUrl, setOpenUrl] = useState('');
    const [published, setPublished] = useState([]);
    const [catalogError, setCatalogError] = useState('');
    useEffect(() => {
      let active = true;
      const operation = startOperation('resource.catalog_load');
      void fetch(`${API}/resources?age_group=${encodeURIComponent(profile.age_group)}&language=${encodeURIComponent(profile.language)}`).then(async response => {
        if (!response.ok) {
          operation.event('rejected', { source: 'cloud', status_code: response.status });
          throw new Error('resource_catalog_error');
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
          console.error('[DexPlay resources] catalog_load_failed', {
            error_type: reason instanceof Error ? reason.name : 'UnknownError',
          });
          setCatalogError('resource_catalog_error');
        }
      });
      return () => { active = false; };
    }, [profile.age_group, profile.language]);
    const allResources = [...published, ...resources.filter(item => !published.some(entry => entry.id === item.id))];
    return (
        <section className="page resources-page">
            <div className="page-heading">
                <p className="eyebrow">{localText(dict, 'resources')}</p>
                <h1>{localText(dict, 'resources')}</h1>
                <p>{localText(dict, 'resource_page_description')}</p>
            </div>
            {catalogError && <p className="notice" role="status">{localText(dict, catalogError)}</p>}
            {allResources.length === 0 ? (
                <article className="panel empty-state">
                    <div aria-hidden="true">◇</div>
                    <h2>{localText(dict, 'no_resources')}</h2>
                    <p>{localText(dict, 'resource_empty_description')}</p>
                </article>
            ) : (
                <div className="resource-grid">
                    {allResources.map(item => {
                        const reviewedOn = item.reviewed_at
                            ? new Date(item.reviewed_at).toLocaleDateString(languageLocale(language))
                            : localText(dict, 'resource_date_unavailable');
                        const discoveredOn = item.discovered_at
                            ? new Date(item.discovered_at).toLocaleDateString(languageLocale(language))
                            : localText(dict, 'resource_not_recorded');
                        const checkedOn = item.verified_at
                            ? new Date(item.verified_at).toLocaleDateString(languageLocale(language))
                            : localText(dict, 'resource_not_verified');
                        return (
                            <article className="resource-card" key={item.id}>
                                <span className="resource-type">
                                    {item.externally_sourced
                                        ? localText(dict, 'resource_external_type')
                                        : localText(dict, 'resource_catalog_type')}
                                    {' · '}{(item.language || 'en').toUpperCase()}
                                </span>
                                <h2>{item.title}</h2>
                                {item.externally_sourced ? (
                                    <>
                                        <p>{localText(dict, 'resource_source', { value: item.source })}</p>
                                        <p>{localText(dict, 'resource_access_license', { access: item.access_status, license: item.license })}</p>
                                        <p>{localText(dict, 'resource_age_range', { value: item.age_range })}</p>
                                        <p>{localText(dict, 'resource_activity_relevance', { value: item.mat_relevance })}</p>
                                        <p>{localText(dict, 'resource_safety_notes', { value: item.safety_notes })}</p>
                                        <p>{localText(dict, 'resource_review_notes', { value: item.review_notes || localText(dict, 'resource_none_recorded') })}</p>
                                        <p>{localText(dict, 'resource_discovered_link_checked', {
                                            discovered: discoveredOn,
                                            checked: checkedOn,
                                            status: item.link_status || localText(dict, 'resource_status_unknown'),
                                        })}</p>
                                        <p>{localText(dict, 'resource_reviewed_by', {
                                            reviewer: item.reviewer_role || localText(dict, 'resource_designated_reviewer'),
                                            date: reviewedOn,
                                        })}</p>
                                        <p>{item.clinic_recommended
                                            ? localText(dict, 'resource_clinic_approved', { evidence: item.clinic_approval_evidence })
                                            : localText(dict, 'resource_external_not_recommended')} {localText(dict, 'resource_clinical_caveat')}</p>
                                        <a className="button secondary" href={item.url} target="_blank" rel="noopener noreferrer">
                                            {localText(dict, 'resource_open_external')}
                                        </a>
                                    </>
                                ) : (
                                    <>
                                        {item.license && <p>{localText(dict, 'resource_license_label')}: {item.license}</p>}
                                        <p>{item.clinic_recommended
                                            ? localText(dict, 'resource_clinic_approved', { evidence: item.clinic_approval_evidence })
                                            : localText(dict, 'resource_catalog_not_recommended')}</p>
                                        {resources.some(row => row.id === item.id) ? (
                                            <div className="resource-actions">
                                                <button className="button secondary" onClick={() => setOpenUrl(openUrl === item.id ? '' : item.id)}>
                                                    {openUrl === item.id ? localText(dict, 'close') : localText(dict, 'continue')}
                                                </button>
                                                <button className="text-link danger-link" onClick={() => onDelete(item.id)}>
                                                    {localText(dict, 'delete')}
                                                </button>
                                            </div>
                                        ) : (
                                            <a className="button secondary" href={item.url} target="_blank" rel="noopener noreferrer">
                                                {localText(dict, 'resource_open_catalog')}
                                            </a>
                                        )}
                                        {openUrl === item.id && <ResourcePreview item={item} />}
                                    </>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
function ResourcePreview({ item }) { const [url, setUrl] = useState(''); const { dict } = useI18n(); useEffect(() => { let objectUrl = ''; void caches.open('dexplay-resources').then(cache => cache.match(item.url)).then(async (response) => { if (response) {
    objectUrl = URL.createObjectURL(await response.blob());
    setUrl(objectUrl);
} }); return () => { if (objectUrl)
    URL.revokeObjectURL(objectUrl); }; }, [item.url]); if (!url)
    return <p>{localText(dict, 'resource_offline_open_failed')}</p>; return item.type === 'video' ? <video controls playsInline src={url} className="resource-player"/> : <iframe title={item.title} src={url} className="resource-document"/>; }
function ResourceReviewScreen({ onBack }) {
    const { dict, language } = useI18n();
    const [token, setToken] = useState('');
    const [candidates, setCandidates] = useState([]);
    const [published, setPublished] = useState([]);
    const [status, setStatus] = useState(null);
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
                throw new Error('review_request_failed');
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
            setError('reviewer_credential_required');
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
            setStatus({ key: 'review_access_verified' });
        } catch {
            setError('review_queue_error');
        } finally {
            setBusy(false);
        }
    };
    const discover = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await request('/review/resources/discover', 'POST');
            await loadQueue();
            setStatus({
                key: 'review_discovery_status',
                values: {
                    count: result.added.length,
                    used: result.daily_requests_used,
                    limit: result.daily_request_limit,
                },
            });
        } catch {
            setError('review_discovery_error');
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
            setStatus({ key: action === 'approve' ? 'review_approved_status' : 'review_rejected_status' });
        } catch {
            setError('review_action_error');
        } finally {
            setBusy(false);
        }
    };
    return <section className="page settings-page review-page">
      <div className="page-heading">
        <p className="eyebrow">{localText(dict, 'review_protected_workflow')}</p>
        <h1>{localText(dict, 'review_queue_title')}</h1>
        <p>{localText(dict, 'review_queue_description')}</p>
        <button className="button secondary" onClick={onBack}>{localText(dict, 'back_to_settings')}</button>
      </div>
      <article className="panel review-access-panel">
        <div className="review-access-heading">
          <span className="review-access-icon" aria-hidden="true">🔐</span>
          <div>
            <h2>{localText(dict, 'reviewer_access')}</h2>
            <p>{localText(dict, 'reviewer_access_description')}</p>
          </div>
        </div>
        <label className="review-credential-field">
          {localText(dict, 'reviewer_credential')}
          <input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)}/>
        </label>
        <div className="review-action-grid">
          <article className="review-action-card">
            <span className="review-action-icon" aria-hidden="true">▤</span>
            <h3>{localText(dict, 'review_queue_load')}</h3>
            <p>{localText(dict, 'review_load_action_description')}</p>
            <button className="button secondary" disabled={busy || !token.trim()} onClick={() => void loadQueue()}>
              {localText(dict, 'review_queue_load')} <span aria-hidden="true">→</span>
            </button>
          </article>
          <article className="review-action-card review-discover-action">
            <span className="review-action-icon" aria-hidden="true">✦</span>
            <h3>{localText(dict, 'review_discover')}</h3>
            <p>{localText(dict, 'review_discover_action_description')}</p>
            <button className="button primary" disabled={busy || !token.trim()} onClick={() => void discover()}>
              {localText(dict, 'review_discover')} <span aria-hidden="true">→</span>
            </button>
          </article>
        </div>
        {status && <p className="notice" role="status">{localText(dict, status.key, status.values)}</p>}
        {error && <p className="error-text" role="alert">{localText(dict, error)}</p>}
      </article>
      <article className="panel review-sources-panel">
        <h2>{localText(dict, 'review_allowed_sources_title')}</h2>
        <p>{localText(dict, 'review_allowed_sources')}</p>
        <a className="review-resource-link" href="https://www.theottoolbox.com/feed/" target="_blank" rel="noopener noreferrer">
          <span>{localText(dict, 'review_open_source_feed')}</span><span aria-hidden="true">↗</span>
          <small>www.theottoolbox.com/feed/</small>
        </a>
      </article>
      <h2 className="review-list-heading">{localText(dict, 'review_pending_candidates', { count: candidates.length })}</h2>
      {candidates.map(item => <ReviewCandidateCard key={item.id} item={item} disabled={busy} onReview={review}/>)}
      {!candidates.length && <p>{localText(dict, 'review_no_candidates')}</p>}
      <h2 className="review-list-heading">{localText(dict, 'review_published_resources', { count: published.length })}</h2>
      {published.map(item => <article className="panel review-published-card" key={item.id}>
        <h3>{item.title}</h3>
        <p>{localText(dict, 'resource_source', { value: item.source })}</p>
        <a className="review-resource-link" href={item.url} target="_blank" rel="noopener noreferrer">
          <span>{localText(dict, 'resource_open_external')}</span><span aria-hidden="true">↗</span><small>{item.url}</small>
        </a>
        <p>{localText(dict, 'review_discovered_link_check', {
          discovered: new Date(item.discovered_at).toLocaleString(languageLocale(language)),
          checked: item.verified_at ? new Date(item.verified_at).toLocaleString(languageLocale(language)) : localText(dict, 'review_not_verified'),
          status: item.link_status,
        })}</p>
        <p>{localText(dict, 'resource_access_license', { access: item.access_status, license: item.license_info })} · {localText(dict, 'resource_age_range', { value: item.age_range })}</p>
        <p>{localText(dict, 'resource_activity_relevance', { value: item.mat_relevance })}</p>
        <p>{localText(dict, 'resource_safety_notes', { value: item.safety_notes })}</p>
        <p>{localText(dict, 'resource_review_notes', { value: item.review_notes || localText(dict, 'resource_none_recorded') })}</p>
        <p>{item.clinic_approved
          ? localText(dict, 'resource_clinic_approved', { evidence: item.clinic_approval_evidence })
          : localText(dict, 'resource_external_not_recommended')}</p>
        <p>{localText(dict, 'resource_reviewed_by', {
          reviewer: item.reviewer_role,
          date: item.reviewed_at ? new Date(item.reviewed_at).toLocaleString(languageLocale(language)) : localText(dict, 'resource_date_unavailable'),
        })}</p>
      </article>)}
    </section>;
}
function ReviewCandidateCard({ item, disabled, onReview }) {
    const { dict, language } = useI18n();
    const [form, setForm] = useState({
        access_status: 'unknown',
        license_info: '',
        age_range: '',
        mat_relevance: '',
        safety_notes: '',
        review_notes: '',
        link_verified: item.link_status === 'HTTP 200',
        clinic_approved: false,
        clinic_approval_evidence: '',
    });
    const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
    return <article className="panel review-candidate">
      <header className="review-candidate-header">
        <div className="review-candidate-title">
          <span className="review-candidate-status">{localText(dict, 'review_candidate_unapproved')}</span>
          <h3>{item.title}</h3>
          <p>{localText(dict, 'review_source_publisher', { source: item.source })}</p>
        </div>
        <a className="review-resource-link" href={item.url} target="_blank" rel="noopener noreferrer">
          <span>{localText(dict, 'review_open_candidate')}</span><span aria-hidden="true">↗</span><small>{item.url}</small>
        </a>
      </header>
      <div className="review-candidate-meta">
        <span className="review-meta-label">{localText(dict, 'review_link_check_label')}</span>
        <span>{item.link_status || localText(dict, 'review_not_checked')}</span>
        <span>{localText(dict, 'review_discovered_link_check', {
          discovered: new Date(item.discovered_at).toLocaleString(languageLocale(language)),
          checked: item.verified_at ? new Date(item.verified_at).toLocaleString(languageLocale(language)) : localText(dict, 'review_not_checked'),
          status: item.link_status,
        })}</span>
      </div>
      <div className="review-form">
        <fieldset className="review-form-section">
          <legend>{localText(dict, 'review_access_license_title')}</legend>
          <div className="review-form-grid">
            <label>{localText(dict, 'review_access_status')}<select value={form.access_status} onChange={event => change('access_status', event.target.value)}>
              <option value="unknown">{localText(dict, 'review_access_unknown')}</option>
              <option value="free_public">{localText(dict, 'review_access_free')}</option>
              <option value="account_required">{localText(dict, 'review_access_account')}</option>
              <option value="paid">{localText(dict, 'review_access_paid')}</option>
            </select></label>
            <label>{localText(dict, 'review_license')}<input value={form.license_info} onChange={event => change('license_info', event.target.value)}/></label>
            <label>{localText(dict, 'review_intended_age')}<input value={form.age_range} onChange={event => change('age_range', event.target.value)} placeholder={localText(dict, 'review_age_placeholder')}/></label>
          </div>
        </fieldset>
        <fieldset className="review-form-section">
          <legend>{localText(dict, 'review_relevance_safety_title')}</legend>
          <div className="review-form-grid">
            <label>{localText(dict, 'review_activity_relevance')}<textarea value={form.mat_relevance} onChange={event => change('mat_relevance', event.target.value)}/></label>
            <label>{localText(dict, 'review_safety')}<textarea value={form.safety_notes} onChange={event => change('safety_notes', event.target.value)}/></label>
            {item.link_status !== 'HTTP 200' && <label className="review-check-card"><input type="checkbox" checked={form.link_verified} onChange={event => change('link_verified', event.target.checked)}/><span>{localText(dict, 'review_manual_link_check')}</span></label>}
            <label className="review-notes-field">{localText(dict, 'review_reviewer_notes')}<textarea value={form.review_notes} onChange={event => change('review_notes', event.target.value)}/></label>
          </div>
        </fieldset>
        <fieldset className="review-form-section review-approval-section">
          <legend>{localText(dict, 'review_decision_title')}</legend>
          <label className="review-check-card"><input type="checkbox" checked={form.clinic_approved} onChange={event => change('clinic_approved', event.target.checked)}/><span>{localText(dict, 'review_clinic_approval')}</span></label>
          {form.clinic_approved && <label>{localText(dict, 'review_clinic_evidence')}<textarea value={form.clinic_approval_evidence} onChange={event => change('clinic_approval_evidence', event.target.value)} placeholder={localText(dict, 'review_clinic_evidence_placeholder')}/></label>}
          <p className="review-publish-note">{localText(dict, 'review_publish_requirements')}</p>
          <div className="form-actions">
            <button className="button secondary" disabled={disabled} onClick={() => onReview(item.id, 'reject')}>{localText(dict, 'review_reject')}</button>
            <button className="button primary" disabled={disabled || form.access_status !== 'free_public' || !form.age_range.trim() || !form.mat_relevance.trim() || !form.safety_notes.trim() || !form.license_info.trim() || (item.link_status !== 'HTTP 200' && !form.review_notes.trim()) || (form.clinic_approved && !form.clinic_approval_evidence.trim())} onClick={() => onReview(item.id, 'approve', form)}>{localText(dict, 'review_approve_publish')}</button>
          </div>
        </fieldset>
      </div>
    </article>;
}
function SettingsScreen({ profile, clinic, theme, highContrast, voice, aiConsent, onAiConsent, apiKey, reminderTime, notifyPermission, installPrompt, onResourceReview, onLanguage, onProfileLanguage, onTheme, onContrast, onVoice, onApiKey, onReminder, onPermission, onDelete, onRefreshInstall, onResources, onSyncComplete }) {
    const { dict, language } = useI18n();
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
                setPaypalConfigError('payment_environment_error');
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
            setActivationError('settings_action_error');
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
            throw new Error('payment_checkout_error');
        }
        const data = await response.json();
        operation.complete({ source: 'cloud', status_code: response.status });
        window.location.assign(data.approval_url);
        } catch (err) {
        operation.fail(err, { source: 'cloud' });
        setActivationError('payment_checkout_error');
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
            throw new Error('qr_unsupported');
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
        setActivationError('qr_scan_error');
        } finally {
        setScan(false);
        }
    };
    const enableNotify = async () => { if (!('Notification' in window)) {
        setActivationError('notifications_unsupported');
        return;
    } const permission = await Notification.requestPermission(); onPermission(permission); };
    const syncNow = async () => { if (!apiKey) {
        setActivationError('report_locked');
        return;
    } setBusy(true); setSyncMessage({ key: 'syncing_saved_sessions' }); setSyncError(false); try {
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
        const hasPartialResults = reportErrorCount > 0 || resourceFailureCount > 0 || resourceGapCount > 0;
        const messageKey = syncedCount
            ? hasPartialResults
                ? 'sync_partial'
                : aiSkippedCount > 0
                    ? 'sync_ai_skipped'
                    : 'sync_complete'
            : skippedCount
                ? 'sync_no_round_data'
                : 'sync_no_sessions';
        setSyncMessage({
            key: messageKey,
            values: { count: syncedCount || skippedCount },
        });
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
        setSyncMessage({ key: 'sync_failed' });
        console.error('[DexPlay sync] failed', {
            error_type: err instanceof Error ? err.name : 'UnknownError',
        });
    }
    finally {
        setBusy(false);
    } };
    const exportData = async () => { const database = await db(); const result = { profile, patients: await database.getAll('patients'), sessions: await database.getAll('sessions'), rounds: await database.getAll('rounds'), created_at: new Date().toISOString() }; const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'dexplay-export.json'; a.click(); URL.revokeObjectURL(url); };
    const deleteCloud = async () => { if (!apiKey)
        return; if (!confirm(localText(dict, 'delete_cloud_confirmation')))
        return; const response = await fetch(`${API}/privacy/account`, { method: 'DELETE', headers: { 'X-Device-Key': apiKey } }); if (!response.ok) {
        setActivationError('delete_cloud_error');
        return;
    } await onApiKey(''); setActivationError('delete_cloud_success'); };
    const install = async () => { if (!installPrompt)
        return; await installPrompt.prompt(); await installPrompt.userChoice; onRefreshInstall(); };
    return (
      <section className="page settings-page">
        <div className="page-heading">
          <p className="eyebrow">{localText(dict, 'settings')}</p>
          <h1>{localText(dict, 'settings')}</h1>
          <p>{localText(dict, 'camera_privacy')}</p>
        </div>
        <article className="panel settings-section">
          <h2>{localText(dict, 'language')}</h2>
          <LanguageSelect value={language} onChange={onLanguage} label={localText(dict, 'therapist_language')}/>
          <LanguageSelect value={profile.language} onChange={onProfileLanguage} label={localText(dict, 'patient_language')}/>
        </article>
        <article className="panel settings-section">
          <h2>{localText(dict, 'optional_ai_consent', { name: profile.name })}</h2>
          <p>{aiConsentDescription(language)} {localText(dict, 'provider_name')}</p>
          <label className="switch-row">
            <span>{localText(dict, aiConsent ? 'ai_analysis_enabled' : 'ai_analysis_off')}</span>
            <input type="checkbox" checked={aiConsent} onChange={event => onAiConsent(event.target.checked)}/>
          </label>
        </article>
        <article className="panel settings-section">
          <h2>{localText(dict, 'theme')}</h2>
          <label>{localText(dict, 'theme')}<select value={theme} onChange={event => onTheme(event.target.value)}>
            <option value="child">{localText(dict, 'theme_child')}</option>
            <option value="clinical">{localText(dict, 'theme_clinical')}</option>
            <option value="senior">{localText(dict, 'theme_senior')}</option>
          </select></label>
          <label className="switch-row"><span>{localText(dict, 'high_contrast')}</span><input type="checkbox" checked={highContrast} onChange={event => onContrast(event.target.checked)}/></label>
          <label className="switch-row"><span>{localText(dict, 'voice')}</span><input type="checkbox" checked={voice} onChange={event => onVoice(event.target.checked)}/></label>
        </article>
        <article className="panel settings-section">
          <h2>{localText(dict, 'activate_key')}</h2>
          {apiKey ? <p className="success-text">✓ {localText(dict, 'key_active')}</p> : (
            <form className="key-form" onSubmit={activate}>
              <label>{localText(dict, 'key_placeholder')}<input value={keyInput} onChange={event => setKeyInput(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 12))} minLength={12} maxLength={12} autoComplete="off"/></label>
              <button className="button primary" disabled={busy || keyInput.length !== 12}>{busy ? localText(dict, 'continue') : localText(dict, 'activate')}</button>
              <button type="button" className="button secondary" onClick={() => void scanQr()} disabled={busy}>{scan ? localText(dict, 'qr_scanning') : localText(dict, 'scan_qr')}</button>
            </form>
          )}
          {clinicKeys.length > 1 && <details><summary>{localText(dict, 'clinic_access_keys')}</summary>{clinicKeys.map(item => <div key={item.label} className="key-row"><span>{item.label}</span><code>{item.api_key}</code></div>)}</details>}
          {activationError && <p className="error-text" role="alert">{localText(dict, activationError)}</p>}
        </article>
        <article className="panel settings-section">
          <h2>{localText(dict, 'subscription')}</h2>
          <p>{localText(dict, 'report_locked')}</p>
          {paypalConfig ? (
            <p className={`notice payment-mode ${paypalConfig.mode === 'sandbox' ? 'sandbox' : 'live'}`}>
              <strong>{localText(dict, paypalConfig.mode === 'sandbox' ? 'sandbox_payment_notice' : 'live_payment_notice')}</strong>
              {!paypalConfig.enabled && ` ${localText(dict, 'payments_not_configured')}`}
            </p>
          ) : <p className="notice" role={paypalConfigError ? 'alert' : undefined}>{localText(dict, paypalConfigError || 'payment_environment_checking')}</p>}
          <label>{localText(dict, 'child_name')}<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="+254…"/></label>
          <label className="consent-check"><input type="checkbox" checked={smsConsent} onChange={event => setSmsConsent(event.target.checked)}/>{localText(dict, 'sms_optin')}</label>
          <div className="plan-buttons">
            <button className="button secondary" disabled={busy || !online} onClick={() => void subscribe('individual')}>{localText(dict, 'individual_plan')}</button>
            <button className="button primary" disabled={busy || !online} onClick={() => void subscribe('clinic')}>{localText(dict, 'clinic_plan')}</button>
          </div>
          {!online && <p className="muted">{localText(dict, 'payment_requires_internet')}</p>}
        </article>
        <article className="panel settings-section">
          <h2>{localText(dict, 'sync')}</h2>
          <label>{localText(dict, 'queue')}<input type="time" value={reminderTime} onChange={event => onReminder(event.target.value)}/></label>
          <button className="button secondary" onClick={() => void enableNotify()}>
            {localText(dict, notifyPermission === 'granted' ? 'notifications_enabled' : 'enable_daily_reminders')}
          </button>
          <p className="muted">{localText(dict, 'reminder_description')}</p>
          <button className="button primary" disabled={busy || !online || !apiKey} onClick={() => void syncNow()}>
            {busy ? localText(dict, 'syncing_saved_sessions') : localText(dict, 'sync')}
          </button>
          {syncMessage && <p className={syncError ? 'error-text' : 'success-text'} role={syncError ? 'alert' : 'status'}>{localText(dict, syncMessage.key, syncMessage.values)}</p>}
          <div className="settings-inline">
            <button className="text-link" onClick={() => void exportData()}>{localText(dict, 'export')}</button>
            <button className="text-link" onClick={() => window.print()}>{localText(dict, 'print')}</button>
            <button className="text-link" onClick={onResourceReview}>{localText(dict, 'resource_reviewer_open')}</button>
          </div>
          {apiKey && <button className="text-link danger-link" onClick={() => void deleteCloud()}>{localText(dict, 'delete_data')}</button>}
        </article>
        <article className="panel settings-section">
          <h2>DexPlay</h2>
          <p>{localText(dict, 'offline')}</p>
          <button className="button secondary" onClick={() => void install()} disabled={!installPrompt}>
            {localText(dict, installPrompt ? 'install_app' : 'install_unavailable')}
          </button>
          <button className="text-link danger-link" onClick={() => void onDelete()}>
            {localText(dict, 'delete_this_device')}
          </button>
        </article>
      </section>
    );
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
