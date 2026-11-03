import { useEffect, useMemo, useState } from 'react';
import { db, getSetting, recentSessions, setSetting } from '../db';
import { t, useI18n, type Dictionary, type Language } from '../i18n';

const API = import.meta.env.VITE_API_URL || '/api';
const AUDIENCES = ['parent', 'therapist', 'patient'] as const;

type Audience = typeof AUDIENCES[number];
type Report = Partial<Record<Audience, { report_text?: string; summary?: string; language?: Language }>>;
type SessionRow = {
    id: string;
    started_at: string;
    mode: string;
};
type RoundRow = {
    id: string;
    round_num: number;
    mode: string;
    objects_placed: number;
    objects_total: number;
    avg_time: number;
    fumbles: number;
    accuracy: number;
};

type ReportsScreenProps = {
    profile: { id: string; name: string; language: Language };
    cloudReport: Report | null;
    analysisStatus: { key: string; values?: Record<string, string | number> } | null;
    difficultyProposal: Record<string, number | string | null> | null;
    onDifficultyAccept: (proposal: Record<string, number | string | null>) => void;
    onDifficultyDecline: () => void;
    apiKey: string;
    aiConsent: boolean;
    online: boolean;
    onPrint: () => void;
    onPlay: () => void;
    onSettings: () => void;
};

export function ReportsScreen({
    profile,
    cloudReport,
    analysisStatus,
    difficultyProposal,
    onDifficultyAccept,
    onDifficultyDecline,
    apiKey,
    aiConsent,
    online,
    onPrint,
    onPlay,
    onSettings,
}: ReportsScreenProps) {
    const { dict, language } = useI18n();
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [rounds, setRounds] = useState<RoundRow[]>([]);
    const [storedReport, setStoredReport] = useState<Report | null>(cloudReport);
    const [loadError, setLoadError] = useState(false);
    const [displayReport, setDisplayReport] = useState<Report | null>(null);
    const [translationState, setTranslationState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

    useEffect(() => {
        let active = true;
        setStoredReport(cloudReport);
        void (async () => {
            try {
                const rows = await recentSessions(profile.id, 200) as SessionRow[];
                if (!active)
                    return;
                setSessions(rows);
                if (!rows[0]) {
                    setRounds([]);
                    return;
                }
                const database = await db();
                const allRounds = await database.getAllFromIndex('rounds', 'by-session', rows[0].id) as RoundRow[];
                const saved = await getSetting<Report | null>(`report:${rows[0].id}`, null);
                if (active) {
                    setRounds(allRounds);
                    if (hasReportContent(cloudReport))
                        setStoredReport(cloudReport);
                    else
                        setStoredReport(saved);
                    setLoadError(false);
                }
            } catch (error) {
                console.error('[DexPlay reports] local_data_load_failed', {
                    error_type: error instanceof Error ? error.name : 'UnknownError',
                });
                if (active)
                    setLoadError(true);
            }
        })();
        return () => {
            active = false;
        };
    }, [profile.id, cloudReport]);

    const sourceReport = hasReportContent(cloudReport) ? cloudReport : storedReport;
    const currentSessionId = sessions[0]?.id;
    const sourceTexts = useMemo(() => reportTexts(sourceReport), [sourceReport]);
    const sourceLanguages = useMemo(() => reportLanguages(sourceReport, profile.language), [sourceReport, profile.language]);

    useEffect(() => {
        let active = true;
        setDisplayReport(null);
        if (!Object.keys(sourceTexts).length) {
            setTranslationState('idle');
            return () => {
                active = false;
            };
        }
        const audiencesNeedingTranslation = AUDIENCES.filter(audience =>
            sourceTexts[audience] && sourceLanguages[audience] !== language
        );
        if (!audiencesNeedingTranslation.length) {
            setDisplayReport(sourceReport);
            setTranslationState('ready');
            return () => {
                active = false;
            };
        }

        setTranslationState('loading');
        void (async () => {
            const translated: Partial<Record<Audience, string>> = {};
            const missing: Audience[] = [];
            const cacheKey = currentSessionId
                ? `report-translation:${currentSessionId}:${language}`
                : null;
            try {
                let cache: { source: Partial<Record<Audience, string>>; translated: Partial<Record<Audience, string>> } | null = null;
                if (cacheKey) {
                    try {
                        cache = await getSetting<{
                            source: Partial<Record<Audience, string>>;
                            translated: Partial<Record<Audience, string>>;
                        } | null>(cacheKey, null);
                    } catch (error) {
                        console.error('[DexPlay reports] translation_cache_read_failed', {
                            error_type: error instanceof Error ? error.name : 'UnknownError',
                        });
                    }
                }
                for (const audience of AUDIENCES) {
                    const sourceText = sourceTexts[audience];
                    if (!sourceText)
                        continue;
                    if (sourceLanguages[audience] === language) {
                        translated[audience] = sourceText;
                    } else if (cache?.source[audience] === sourceText && cache.translated[audience]) {
                        translated[audience] = cache.translated[audience];
                    } else {
                        missing.push(audience);
                    }
                }

                if (missing.length && aiConsent && apiKey && online) {
                    await Promise.all(missing.map(async audience => {
                        const response = await fetch(`${API}/reports/translate`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Device-Key': apiKey,
                            },
                            body: JSON.stringify({
                                audience,
                                report_text: sourceTexts[audience],
                                source_language: sourceLanguages[audience] || profile.language,
                                target_language: language,
                                ai_consent: true,
                            }),
                        });
                        if (!response.ok)
                            throw new Error(`Report translation failed (${response.status}).`);
                        const result = await response.json() as { translated_text?: string; language?: string };
                        if (result.language !== language || typeof result.translated_text !== 'string' || !result.translated_text.trim())
                            throw new Error('The translation response did not match the requested language.');
                        translated[audience] = result.translated_text;
                    }));
                }

                if (missing.length && cacheKey && Object.keys(translated).length) {
                    const completeSource: Partial<Record<Audience, string>> = {};
                    for (const audience of AUDIENCES) {
                        if (sourceTexts[audience])
                            completeSource[audience] = sourceTexts[audience];
                    }
                    try {
                        await setSetting(cacheKey, { source: completeSource, translated });
                    } catch (error) {
                        console.error('[DexPlay reports] translation_cache_write_failed', {
                            error_type: error instanceof Error ? error.name : 'UnknownError',
                        });
                    }
                }

                if (!active)
                    return;
                const translatedReport = withTranslatedTexts(sourceReport, translated);
                const complete = AUDIENCES
                    .filter(audience => sourceTexts[audience])
                    .every(audience => translated[audience]);
                setDisplayReport(complete && hasReportContent(translatedReport) ? translatedReport : null);
                setTranslationState(complete ? 'ready' : 'unavailable');
            } catch (error) {
                console.error('[DexPlay reports] translation_unavailable', {
                    error_type: error instanceof Error ? error.name : 'UnknownError',
                    target_language: language,
                });
                if (active) {
                    setDisplayReport(null);
                    setTranslationState('unavailable');
                }
            }
        })();
        return () => {
            active = false;
        };
    }, [sourceReport, sourceTexts, sourceLanguages, currentSessionId, profile.language, language, aiConsent, apiKey, online]);

    const placed = rounds.reduce((sum, row) => sum + row.objects_placed, 0);
    const total = rounds.reduce((sum, row) => sum + row.objects_total, 0);
    const averageAccuracy = rounds.length
        ? Math.round(rounds.reduce((sum, row) => sum + row.accuracy, 0) / rounds.length * 100)
        : 0;
    const fumbles = rounds.reduce((sum, row) => sum + row.fumbles, 0);
    const averageTime = rounds.length
        ? (rounds.reduce((sum, row) => sum + row.avg_time, 0) / rounds.length).toFixed(1)
        : '0.0';
    const currentMode = rounds[0]?.mode || sessions[0]?.mode || 'sort_place';
    const modeName = t(dict, currentMode);
    const hasReport = hasReportContent(displayReport);

    return (
        <section className="page report-page">
            <header className="report-header">
                <div>
                    <p className="eyebrow">{t(dict, 'reports')}</p>
                    <h1>{t(dict, 'report_title', { name: profile.name })}</h1>
                    <p className="report-subtitle">
                        {t(dict, 'report_session_count', { count: sessions.length, mode: modeName })}
                    </p>
                </div>
                <button className="button primary" onClick={onPlay}>{t(dict, 'start')}</button>
            </header>

            {loadError && <p className="notice" role="alert">{t(dict, 'report_load_error')}</p>}
            {analysisStatus && <p className="notice report-status" role="status">{t(dict, analysisStatus.key, analysisStatus.values)}</p>}

            <section className="report-section" aria-labelledby="report-results-title">
                <div className="report-section-heading">
                    <div>
                        <p className="eyebrow">{t(dict, 'report_session_summary')}</p>
                        <h2 id="report-results-title">{t(dict, 'report_results_title')}</h2>
                    </div>
                    <span className="report-mode-badge">{modeName}</span>
                </div>
                <p className="report-section-description">{t(dict, 'report_results_description', { mode: modeName })}</p>
                <div className="report-metrics">
                    <Metric label={t(dict, metricLabelKey(currentMode, 'placed'))} value={`${placed}/${total}`} />
                    <Metric label={t(dict, 'report_accuracy')} value={`${averageAccuracy}%`} />
                    <Metric label={t(dict, 'report_average_time')} value={`${averageTime}s`} />
                    <Metric label={t(dict, metricLabelKey(currentMode, 'fumbles'))} value={String(fumbles)} />
                </div>
                {rounds.length > 0 ? (
                    <div className="report-rounds">
                        <h3>{t(dict, 'report_round_details')}</h3>
                        <ol>
                            {rounds.map(row => {
                                const accuracy = Math.round(row.accuracy * 100);
                                return (
                                    <li className="report-round" key={row.id}>
                                        <div className="report-round-heading">
                                            <strong>{t(dict, 'report_round_number', { number: row.round_num })}</strong>
                                            <span>{accuracy}%</span>
                                        </div>
                                        <div
                                            className="report-progress-track"
                                            role="progressbar"
                                            aria-label={t(dict, 'report_round_accuracy')}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={accuracy}
                                        >
                                            <span style={{ width: `${accuracy}%` }} />
                                        </div>
                                        <p>{t(dict, 'report_round_detail', {
                                            placed: row.objects_placed,
                                            total: row.objects_total,
                                            seconds: row.avg_time,
                                            fumbles: row.fumbles,
                                        })}</p>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                ) : (
                    <p className="report-empty">{t(dict, 'report_no_rounds')}</p>
                )}
            </section>

            {difficultyProposal && (
                <DifficultyProposal
                    proposal={difficultyProposal}
                    dict={dict}
                    onAccept={onDifficultyAccept}
                    onDecline={onDifficultyDecline}
                />
            )}

            <section className="report-section report-feedback" aria-labelledby="report-feedback-title">
                <div className="report-section-heading">
                    <div>
                        <p className="eyebrow">{t(dict, 'report_ai_eyebrow')}</p>
                        <h2 id="report-feedback-title">{t(dict, 'report_feedback_title')}</h2>
                    </div>
                    {hasReport && <button className="button secondary" onClick={onPrint}>{t(dict, 'print')}</button>}
                </div>
                {sourceReport ? (
                    <>
                        <p className="report-disclaimer">{t(dict, 'report_disclaimer')}</p>
                        {translationState === 'loading' && <p className="notice" role="status">{t(dict, 'report_translation_loading')}</p>}
                        {translationState === 'unavailable' && (
                            <p className="notice" role="status">{t(dict, 'report_translation_unavailable')}</p>
                        )}
                        {hasReport && <div className="report-feedback-grid">
                            {AUDIENCES.map(audience => displayReport?.[audience]?.report_text && (
                                <article className={`report-feedback-card report-feedback-${audience}`} key={audience}>
                                    <h3>{t(dict, audience)}</h3>
                                    <p>{displayReport[audience]?.report_text}</p>
                                </article>
                            ))}
                        </div>}
                    </>
                ) : (
                    <div className="report-empty-card">
                        <p>{t(dict, 'report_ai_unavailable')}</p>
                        {apiKey && <button className="button secondary" onClick={onSettings}>{t(dict, 'settings')}</button>}
                    </div>
                )}
            </section>

            <section className="report-section report-history" aria-labelledby="report-history-title">
                <div className="report-section-heading">
                    <div>
                        <p className="eyebrow">{t(dict, 'report_history_eyebrow')}</p>
                        <h2 id="report-history-title">{t(dict, 'recent_sessions')}</h2>
                    </div>
                    <span className="report-history-count">{sessions.length}</span>
                </div>
                {sessions.length ? (
                    <ol className="report-session-list">
                        {sessions.slice(0, 10).map(session => (
                            <li key={session.id}>
                                <time dateTime={session.started_at}>
                                    {new Date(session.started_at).toLocaleString(languageLocale(language))}
                                </time>
                                <span>{t(dict, session.mode)}</span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="report-empty">{t(dict, 'report_no_sessions')}</p>
                )}
            </section>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <article className="report-metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </article>
    );
}

function DifficultyProposal({
    proposal,
    dict,
    onAccept,
    onDecline,
}: {
    proposal: Record<string, number | string | null>;
    dict: Dictionary;
    onAccept: (proposal: Record<string, number | string | null>) => void;
    onDecline: () => void;
}) {
    const [draft, setDraft] = useState({ ...proposal });
    const update = (key: string, value: number) => setDraft(current => ({ ...current, [key]: value }));
    const valid = Number.isInteger(draft.object_size_mm) && Number(draft.object_size_mm) >= 12 && Number(draft.object_size_mm) <= 60 &&
        Number.isInteger(draft.time_limit_s) && Number(draft.time_limit_s) >= 20 && Number(draft.time_limit_s) <= 600 &&
        Number.isInteger(draft.objects_count) && Number(draft.objects_count) >= 1 && Number(draft.objects_count) <= 30;

    return (
        <section className="report-section difficulty-proposal">
            <p className="eyebrow">{t(dict, 'report_ai_eyebrow')}</p>
            <h2>{t(dict, 'difficulty_proposal_title')}</h2>
            <p>{proposal.rationale || t(dict, 'difficulty_proposal_description')}</p>
            <div className="difficulty-fields">
                <label>{t(dict, 'difficulty_object_size')}<input type="number" min="12" max="60" value={draft.object_size_mm ?? 22} onChange={event => update('object_size_mm', Number(event.target.value))} /></label>
                <label>{t(dict, 'difficulty_time_limit')}<input type="number" min="20" max="600" value={draft.time_limit_s ?? 60} onChange={event => update('time_limit_s', Number(event.target.value))} /></label>
                <label>{t(dict, 'difficulty_objects_count')}<input type="number" min="1" max="30" value={draft.objects_count ?? 5} onChange={event => update('objects_count', Number(event.target.value))} /></label>
            </div>
            <div className="form-actions">
                <button className="button secondary" onClick={onDecline}>{t(dict, 'decline')}</button>
                <button className="button primary" disabled={!valid} onClick={() => onAccept(draft)}>{t(dict, 'accept')}</button>
            </div>
        </section>
    );
}

function hasReportContent(report: Report | null | undefined): report is Report {
    return Boolean(report && AUDIENCES.some(audience => report[audience]?.report_text));
}

function reportTexts(report: Report | null): Partial<Record<Audience, string>> {
    const texts: Partial<Record<Audience, string>> = {};
    for (const audience of AUDIENCES) {
        const text = report?.[audience]?.report_text;
        if (text)
            texts[audience] = text;
    }
    return texts;
}

function reportLanguages(report: Report | null, fallback: Language): Partial<Record<Audience, Language>> {
    const result: Partial<Record<Audience, Language>> = {};
    for (const audience of AUDIENCES) {
        if (report?.[audience]?.report_text)
            result[audience] = report[audience]?.language || fallback;
    }
    return result;
}

function withTranslatedTexts(report: Report | null, translated: Partial<Record<Audience, string>>): Report | null {
    if (!report)
        return null;
    const result = { ...report };
    for (const audience of AUDIENCES) {
        if (translated[audience] && report[audience])
            result[audience] = { ...report[audience], report_text: translated[audience] };
    }
    return result;
}

function metricLabelKey(mode: string, metric: 'placed' | 'fumbles') {
    if (metric === 'placed') {
        if (mode === 'stack')
            return 'report_items_stacked';
        if (mode === 'thread')
            return 'report_items_threaded';
        if (mode === 'button')
            return 'report_buttons_completed';
        return 'report_items_sorted';
    }
    if (mode === 'stack')
        return 'report_drops';
    if (mode === 'thread')
        return 'report_missed_attempts';
    if (mode === 'button')
        return 'report_missed_presses';
    return 'report_misplacements';
}

function languageLocale(language: Language) {
    return {
        en: 'en-US',
        es: 'es-ES',
        hi: 'hi-IN',
        zh: 'zh-CN',
        ar: 'ar',
        sw: 'sw-KE',
        pt: 'pt-BR',
        fr: 'fr-FR',
        bn: 'bn-BD',
        tl: 'fil-PH',
    }[language] ?? 'en-US';
}
