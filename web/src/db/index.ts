import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface Profile { id:string; name:string; age_years?:number; age_group:string; condition:string; hand:string; language:string; created_at:string; difficulty:Record<string,number|null>; }
export interface Round { id:string; session_id:string; round_num:number; mode:string; objects_placed:number; objects_total:number; avg_time:number; fumbles:number; accuracy:number; }
export interface Session { id:string; profile_id:string; patient_id?:string; started_at:string; ended_at?:string; difficulty_params:Record<string,number|null>; mode:string; }
export interface ResourceMeta { id:string; title:string; type:'video'|'pdf'|'guide'; url:string; size_mb:number; downloaded_at:string; profile_match:string; language:string; sha256?:string; }
interface Store<T> { key:string; value:T; }
interface QueuedSync { id:string; payload:Record<string,unknown>; timestamp:string; synced:boolean; }
interface DexPlayDB extends DBSchema {
  sessions: {key:string; value:Session; indexes:{'by-profile':string,'by-started':string}}
  rounds: {key:string; value:Round; indexes:{'by-session':string}}
  settings: {key:string; value:Store<unknown>}
  sync_queue: {key:string; value:QueuedSync}
  resource_cache: {key:string; value:ResourceMeta; indexes:{'by-language':string}}
  usage_stats: {key:string; value:Store<unknown>}
  patients: {key:string; value:Profile; indexes:{'by-name':string}}
}

let database: Promise<IDBPDatabase<DexPlayDB>> | undefined
export function db() {
  if (!database) database = openDB<DexPlayDB>('dexplay-production', 1, {upgrade(database) {
    const sessions = database.createObjectStore('sessions', {keyPath:'id'}); sessions.createIndex('by-profile','profile_id'); sessions.createIndex('by-started','started_at')
    const rounds = database.createObjectStore('rounds', {keyPath:'id'}); rounds.createIndex('by-session','session_id')
    database.createObjectStore('settings', {keyPath:'key'})
    database.createObjectStore('sync_queue', {keyPath:'id'})
    const cache = database.createObjectStore('resource_cache', {keyPath:'id'}); cache.createIndex('by-language','language')
    database.createObjectStore('usage_stats', {keyPath:'key'})
    const patients = database.createObjectStore('patients', {keyPath:'id'}); patients.createIndex('by-name','name')
  }})
  return database
}

export async function getSetting<T>(key:string, fallback:T):Promise<T> {
  const row = await (await db()).get('settings', key)
  return (row?.value as T | undefined) ?? fallback
}
export async function setSetting<T>(key:string,value:T) { await (await db()).put('settings',{key,value}) }
export async function saveSession(session:Session, rounds:Round[]) {
  const database = await db(); const tx = database.transaction(['sessions','rounds'],'readwrite')
  await tx.objectStore('sessions').put(session)
  for (const round of rounds) await tx.objectStore('rounds').put(round)
  await tx.done
}
export async function recentSessions(profileId?:string, limit=30) {
  const database = await db()
  const rows = profileId ? await database.getAllFromIndex('sessions','by-profile',profileId) : await database.getAll('sessions')
  return rows.sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,limit)
}
export async function queueSync(payload:Record<string,unknown>) {
  const row:QueuedSync={id:crypto.randomUUID(),payload,timestamp:new Date().toISOString(),synced:false}
  await (await db()).put('sync_queue',row)
  try { const registration=await navigator.serviceWorker.ready; if ('sync' in registration) await (registration as ServiceWorkerRegistration & {sync:{register:(tag:string)=>Promise<void>}}).sync.register('dexplay-session-sync') } catch { /* Network retry remains available from Settings. */ }
  return row.id
}
export async function removeQueuedSync(id:string){await (await db()).delete('sync_queue',id)}
export async function pendingSyncCount() { return (await db()).getAll('sync_queue').then(rows=>rows.filter(row=>!row.synced).length) }
