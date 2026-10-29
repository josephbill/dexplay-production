// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, getSetting, pendingSyncCount, recentSessions, setSetting } from './db';
import { languages, detectLanguage, dictionary, t } from './i18n';
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
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reminderTime, setReminderTime] = useState('18:00'), [notifyPermission, setNotifyPermission] = useState(() => typeof Notification === 'undefined' ? 'default' : Notification.permission);
    const dict = useMemo(() => dictionary(language), [language]);
    const clinic = group === 'clinic';
    const setLang = useCallback(async (next) => { setLanguage(next); localStorage.setItem('dexplay.language', next); await setSetting('language', next); }, []);
    useEffect(() => {
        let live = true;
        void (async () => {
            const [savedLanguage, savedGroup, savedProfile, savedTheme, savedContrast, savedVoice, savedKey, savedCalibration, savedReminder] = await Promise.all([
                getSetting('language', detectLanguage()), getSetting('group', null), getSetting('current-profile', null),
                getSetting('theme', 'child'), getSetting('high-contrast', false), getSetting('voice', true),
                getSetting('api-key', ''), getSetting('calibration:default', []), getSetting('reminder-time', '18:00')
            ]);
            const dbPatients = await (await db()).getAll('patients');
            const storedResources = await (await db()).getAll('resource_cache');
            if (!live)
                return;
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
            if (savedProfile && savedGroup)
                setRoute('home');
            else
                setRoute('setup');
            setPending(await pendingSyncCount());
        })().catch(() => setError('Unable to open local storage. Please enable site storage and reload.'));
        const onlineHandler = () => setOnline(true), offlineHandler = () => setOnline(false);
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
        let cancelled = false;
        void (async () => {
            try {
                for (let attempt = 0; attempt < 10; attempt++) {
                    const response = await fetch(`${API}/paypal/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activation_token: token }) });
                    if (response.status === 202) {
                        await new Promise(resolve => setTimeout(resolve, 2500));
                        continue;
                    }
                    if (!response.ok)
                        throw new Error('The payment is not active yet. Please return later or contact support.');
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
                    return;
                }
                throw new Error('PayPal approval is still processing. Check Settings in a moment.');
            }
            catch (err) {
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
        await (await db()).put('patients', next);
        await setSetting('current-profile', next);
        await setSetting('group', next.group);
        setProfile(next);
        setGroup(next.group);
        setPatients(await (await db()).getAll('patients'));
        setRoute('calibrate');
    }, []);
    const changePatient = async (next) => { setProfile(next); await setSetting('current-profile', next); setCalibration(await getSetting(`calibration:${next.id}`, [])); setRoute('home'); };
    const onCalibration = async (points) => {
        setCalibration(points);
        await setSetting('calibration:default', points);
        if (profile)
            await setSetting(`calibration:${profile.id}`, points);
    };
    const finishGame = async (session, _rounds, result) => {
        setCloudReport(null);
        if (result) {
            const reports = result.report;
            if (reports) {
                setCloudReport(reports);
                await setSetting(`report:${session.id}`, reports);
            }
            const next = result.next_difficulty;
            if (next && profile) {
                const revised = { ...profile, difficulty: next };
                await (await db()).put('patients', revised);
                await setSetting('current-profile', revised);
                setProfile(revised);
            }
            const delivered = result.new_resources;
            if (delivered?.length) {
                for (const item of delivered) {
                    try {
                        await downloadResource(item, profile?.id ?? '');
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
    const deleteLocalData = async () => {
        if (!window.confirm('Delete all DexPlay information stored on this device?'))
            return;
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
        location.reload();
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
        {route === 'play' && <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'play')}</p><h1>{profile.name}, {localText(dict, 'welcome')}</h1><p>{localText(dict, 'camera_privacy')}</p></div><GameSession profile={profile} clinic={clinic} voice={voice} dict={dict} calibration={calibration} onCalibration={onCalibration} apiKey={apiKey} onFinished={finishGame} onClose={() => setRoute('home')}/></section>}
        {route === 'patients' && clinic && <ClinicScreen profile={profile} patients={patients} dict={dict} onSwitch={changePatient} onAdd={() => setRoute('setup')} onPlay={() => setRoute('play')}/>}
        {route === 'reports' && <ReportsScreen profile={profile} clinic={clinic} dict={dict} cloudReport={cloudReport} onPrint={() => window.print()} onPlay={() => setRoute('play')}/>}
        {route === 'resources' && <ResourcesScreen resources={resources} dict={dict} onDelete={async (id) => { await removeResource(id); setResources(await (await db()).getAll('resource_cache')); }}/>}
        {route === 'settings' && <SettingsScreen language={language} profile={profile} clinic={clinic} dict={dict} theme={theme} highContrast={highContrast} voice={voice} apiKey={apiKey} reminderTime={reminderTime} notifyPermission={notifyPermission} installPrompt={installPrompt} onLanguage={setLang} onProfileLanguage={async (value) => { const revised = { ...profile, language: value }; setProfile(revised); await (await db()).put('patients', revised); await setSetting('current-profile', revised); }} onTheme={async (value) => { setTheme(value); await setSetting('theme', value); }} onContrast={async (value) => { setHighContrast(value); await setSetting('high-contrast', value); }} onVoice={async (value) => { setVoice(value); await setSetting('voice', value); }} onApiKey={async (value) => { setApiKey(value); await setSetting('api-key', value); }} onReminder={async (value) => { setReminderTime(value); await setSetting('reminder-time', value); }} onPermission={setNotifyPermission} onDelete={deleteLocalData} onRefreshInstall={() => setInstallPrompt(null)} onResources={async () => setResources(await (await db()).getAll('resource_cache'))}/>}
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
function ReportsScreen({ profile, clinic, dict, cloudReport, onPrint, onPlay }) {
    const [sessions, setSessions] = useState([]), [rounds, setRounds] = useState([]);
    useEffect(() => { void (async () => { const rows = await recentSessions(clinic ? undefined : profile.id, 200); setSessions(rows); if (rows[0]) {
        const all = await (await db()).getAllFromIndex('rounds', 'by-session', rows[0].id);
        setRounds(all);
        const saved = await getSetting(`report:${rows[0].id}`, null);
        if (saved)
            setCloudReportSafe(saved);
    } })(); }, [clinic, profile.id]);
    const [storedReport, setStoredReport] = useState(cloudReport);
    const setCloudReportSafe = (value) => setStoredReport(value);
    const chosen = cloudReport ?? storedReport;
    const average = rounds.length ? Math.round(rounds.reduce((sum, row) => sum + row.accuracy, 0) / rounds.length * 100) : 0;
    return <section className="page report-page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'reports')}</p><h1>{localText(dict, 'reports')}</h1><p>{clinic ? localText(dict, 'active_patients') + `: ${sessions.length}` : profile.name}</p><button className="button primary" onClick={onPlay}>{localText(dict, 'start')}</button></div>
    {chosen ? <><div className="report-actions"><button className="button primary" onClick={onPrint}>{localText(dict, 'print')}</button></div><div className="print-report"><div className="report-title"><h2>DexPlay · {profile.name}</h2><p>{new Date(sessions[0]?.started_at ?? Date.now()).toLocaleDateString(languageLocale(profile.language))} · {localText(dict, 'total_sessions')}: {sessions.length} · {localText(dict, 'score')}: {average}%</p></div>{chosen.parent?.report_text && <article className="report-copy"><h3>{localText(dict, 'parent')}</h3><p>{chosen.parent.report_text}</p></article>}{chosen.therapist?.report_text && <article className="report-copy"><h3>{localText(dict, 'therapist')}</h3><p>{chosen.therapist.report_text}</p></article>}{chosen.patient?.report_text && <article className="report-copy"><h3>{localText(dict, 'patient')}</h3><p>{chosen.patient.report_text}</p></article>}</div></> : <article className="panel report-lock"><span className="lock-icon">🔒</span><h2>{localText(dict, 'reports')}</h2><p>{localText(dict, 'report_locked')}</p><p>{localText(dict, 'camera_privacy')}</p><div className="local-progress"><strong>{average}%</strong><span>{localText(dict, 'score')} · {rounds.length} {localText(dict, 'round')}</span></div></article>}
    <div className="panel recent-list"><h2>{localText(dict, 'recent_sessions')}</h2>{sessions.slice(0, 10).map(session => <div className="recent-row" key={session.id}><span>{new Date(session.started_at).toLocaleString(languageLocale(profile.language))}</span><span>{session.mode}</span></div>)}</div>
  </section>;
}
function ResourcesScreen({ resources, dict, onDelete }) {
    const [openUrl, setOpenUrl] = useState('');
    return <section className="page"><div className="page-heading"><p className="eyebrow">{localText(dict, 'resources')}</p><h1>{localText(dict, 'resources')}</h1><p>{localText(dict, 'camera_privacy')}</p></div>{resources.length === 0 ? <article className="panel empty-state"><div>◇</div><h2>{localText(dict, 'no_resources')}</h2></article> : <div className="resource-grid">{resources.map(item => <article className="resource-card" key={item.id}><span className="resource-type">{item.type.toUpperCase()} · {item.language.toUpperCase()}</span><h2>{item.title}</h2><p>{item.size_mb} MB</p><div className="resource-actions"><button className="button secondary" onClick={() => setOpenUrl(openUrl === item.id ? '' : item.id)}>{localText(dict, 'continue')}</button><button className="text-link danger-link" onClick={() => onDelete(item.id)}>{localText(dict, 'delete')}</button></div>{openUrl === item.id && <ResourcePreview item={item}/>}</article>)}</div>}</section>;
}
function ResourcePreview({ item }) { const [url, setUrl] = useState(''); useEffect(() => { let objectUrl = ''; void caches.open('dexplay-resources').then(cache => cache.match(item.url)).then(async (response) => { if (response) {
    objectUrl = URL.createObjectURL(await response.blob());
    setUrl(objectUrl);
} }); return () => { if (objectUrl)
    URL.revokeObjectURL(objectUrl); }; }, [item.url]); if (!url)
    return <p>Offline file could not be opened. Re-download it while online.</p>; return item.type === 'video' ? <video controls playsInline src={url} className="resource-player"/> : <iframe title={item.title} src={url} className="resource-document"/>; }
function SettingsScreen({ language, profile, clinic, dict, theme, highContrast, voice, apiKey, reminderTime, notifyPermission, installPrompt, onLanguage, onProfileLanguage, onTheme, onContrast, onVoice, onApiKey, onReminder, onPermission, onDelete, onRefreshInstall, onResources }) {
    const [keyInput, setKeyInput] = useState(''), [scan, setScan] = useState(false), [phone, setPhone] = useState(''), [smsConsent, setSmsConsent] = useState(false), [activationError, setActivationError] = useState(''), [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine);
    const [clinicKeys, setClinicKeys] = useState([]);
    useEffect(() => { void getSetting('clinic-keys', []).then(setClinicKeys); const on = () => setOnline(navigator.onLine); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); }; }, []);
    const activate = async (event) => { event.preventDefault(); setActivationError(''); setBusy(true); try {
        const response = await fetch(`${API}/keys/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: keyInput, device_label: clinic ? 'clinic-tablet' : profile.name }) });
        if (!response.ok)
            throw new Error(localText(dict, 'key_invalid'));
        await onApiKey(keyInput);
        setKeyInput('');
    }
    catch (err) {
        setActivationError(err instanceof Error ? err.message : localText(dict, 'key_invalid'));
    }
    finally {
        setBusy(false);
    } };
    const subscribe = async (plan) => { setActivationError(''); setBusy(true); try {
        const response = await fetch(`${API}/paypal/create_subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, language, sms_consent: smsConsent, phone_number: smsConsent ? phone || undefined : undefined }) });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || 'Could not create a secure PayPal checkout.');
        }
        const data = await response.json();
        window.location.assign(data.approval_url);
    }
    catch (err) {
        setActivationError(err instanceof Error ? err.message : 'PayPal is temporarily unavailable.');
    }
    finally {
        setBusy(false);
    } };
    const scanQr = async () => { setActivationError(''); try {
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
    }
    catch (err) {
        setActivationError(err instanceof Error ? err.message : 'QR scan failed.');
    }
    finally {
        setScan(false);
    } };
    const enableNotify = async () => { if (!('Notification' in window)) {
        setActivationError('Notifications are not supported by this browser.');
        return;
    } const permission = await Notification.requestPermission(); onPermission(permission); };
    const syncNow = async () => { if (!apiKey) {
        setActivationError(localText(dict, 'report_locked'));
        return;
    } setBusy(true); try {
        const queue = await (await db()).getAll('sync_queue');
        for (const row of queue.filter(item => !item.synced)) {
            const response = await fetch(`${API}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': apiKey }, body: JSON.stringify(row.payload) });
            if (response.ok) {
                await (await db()).delete('sync_queue', row.id);
                const data = await response.json();
                if (data.report)
                    await setSetting('latest-cloud-report', data.report);
            }
            else
                throw new Error('A queued session could not be synced. Check the access key.');
        }
        setActivationError('');
        onResources();
    }
    catch (err) {
        setActivationError(err instanceof Error ? err.message : 'Sync failed.');
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
    <article className="panel settings-section"><h2>{localText(dict, 'theme')}</h2><label>{localText(dict, 'theme')}<select value={theme} onChange={event => onTheme(event.target.value)}><option value="child">{localText(dict, 'theme_child')}</option><option value="clinical">{localText(dict, 'theme_clinical')}</option><option value="senior">{localText(dict, 'theme_senior')}</option></select></label><label className="switch-row"><span>{localText(dict, 'high_contrast')}</span><input type="checkbox" checked={highContrast} onChange={event => onContrast(event.target.checked)}/></label><label className="switch-row"><span>{localText(dict, 'voice')}</span><input type="checkbox" checked={voice} onChange={event => onVoice(event.target.checked)}/></label></article>
    <article className="panel settings-section"><h2>{localText(dict, 'activate_key')}</h2>{apiKey ? <p className="success-text">✓ {localText(dict, 'key_active')}</p> : <form className="key-form" onSubmit={activate}><label>{localText(dict, 'key_placeholder')}<input value={keyInput} onChange={event => setKeyInput(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 12))} minLength={12} maxLength={12} autoComplete="off"/></label><button className="button primary" disabled={busy || keyInput.length !== 12}>{busy ? localText(dict, 'continue') : localText(dict, 'activate')}</button><button type="button" className="button secondary" onClick={() => void scanQr()} disabled={busy}>{scan ? 'Scanning…' : 'Scan QR'}</button></form>}{clinicKeys.length > 1 && <details><summary>Clinic patient access keys</summary>{clinicKeys.map(item => <div key={item.label} className="key-row"><span>{item.label}</span><code>{item.api_key}</code></div>)}</details>}{activationError && <p className="error-text" role="alert">{activationError}</p>}</article>
    <article className="panel settings-section"><h2>{localText(dict, 'subscription')}</h2><p>{localText(dict, 'report_locked')}</p><label>{localText(dict, 'child_name')}<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="+254…"/></label><label className="consent-check"><input type="checkbox" checked={smsConsent} onChange={event => setSmsConsent(event.target.checked)}/>{localText(dict, 'sms_optin')}</label><div className="plan-buttons"><button className="button secondary" disabled={busy || !online} onClick={() => void subscribe('individual')}>{localText(dict, 'individual_plan')}</button><button className="button primary" disabled={busy || !online} onClick={() => void subscribe('clinic')}>{localText(dict, 'clinic_plan')}</button></div>{!online && <p className="muted">Payment requires an internet connection.</p>}</article>
    <article className="panel settings-section"><h2>{localText(dict, 'sync')}</h2><label>{localText(dict, 'queue')}<input type="time" value={reminderTime} onChange={event => onReminder(event.target.value)}/></label><button className="button secondary" onClick={() => void enableNotify()}>{notifyPermission === 'granted' ? 'Notifications enabled' : 'Enable daily reminders'}</button><p className="muted">Daily reminders can appear while this app is open. Push reminders require an active cloud account.</p><button className="button primary" disabled={busy || !online || !apiKey} onClick={() => void syncNow()}>{localText(dict, 'sync')}</button><div className="settings-inline"><button className="text-link" onClick={() => void exportData()}>{localText(dict, 'export')}</button><button className="text-link" onClick={() => window.print()}>{localText(dict, 'print')}</button></div>{apiKey && <button className="text-link danger-link" onClick={() => void deleteCloud()}>{localText(dict, 'delete_data')}</button>}</article>
    <article className="panel settings-section"><h2>DexPlay</h2><p>{localText(dict, 'offline')}</p><button className="button secondary" onClick={() => void install()} disabled={!installPrompt}>{installPrompt ? 'Install app' : 'Already installed or install unavailable'}</button><button className="text-link danger-link" onClick={() => void onDelete()}>{localText(dict, 'delete_data')} · this device</button></article>
  </section>;
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
    const metadata = { id: item.id, title: item.title, type: item.type, url: item.url, size_mb: Number((bytes / 1024 / 1024).toFixed(2)), downloaded_at: new Date().toISOString(), profile_match: profileMatch, language: item.language, sha256: item.sha256 };
    await (await db()).put('resource_cache', metadata);
}
async function removeResource(id) { const database = await db(), resource = await database.get('resource_cache', id); if (resource) {
    const cache = await caches.open('dexplay-resources');
    await cache.delete(resource.url);
    await database.delete('resource_cache', id);
} }
// @ts-nocheck
