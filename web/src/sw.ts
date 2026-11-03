/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST:Parameters<typeof precacheAndRoute>[0]}
const API = import.meta.env.VITE_API_URL || '/api'
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(({request,url})=>request.destination==='image'||/\.(pdf|mp4|webm)$/i.test(url.pathname),
  new CacheFirst({cacheName:'dexplay-resources',plugins:[new ExpirationPlugin({maxEntries:80,maxAgeSeconds:60*60*24*365,purgeOnQuotaError:true})]}))

function openDexDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('dexplay-production',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function flushSessionQueue(){
  const database=await openDexDb();const tx=database.transaction(['settings','sync_queue'],'readonly')
  const settings=await idbRequest(tx.objectStore('settings').get('api-key')) as {value?:string}|undefined
  const apiKey=settings?.value
  if(!apiKey){database.close();return}
  const rows=await idbRequest(tx.objectStore('sync_queue').getAll()) as {id:string;payload:Record<string,unknown>;synced:boolean;profile_id?:string}[]
  await transactionDone(tx)
  for(const row of rows.filter(item=>!item.synced)){
    const patientId=typeof row.payload.patient_id==='string'?row.payload.patient_id:undefined
    const profileId=row.profile_id||patientId
    let currentlyConsented=false
    if(profileId){
      const consentTx=database.transaction('settings','readonly')
      const consent=await idbRequest(consentTx.objectStore('settings').get(`ai-consent:${profileId}`)) as {value?:unknown}|undefined
      await transactionDone(consentTx)
      currentlyConsented=consent?.value===true
    }
    const payload={...row.payload,ai_consent:Boolean(row.payload.ai_consent&&currentlyConsented)}
    const response=await fetch(`${API}/sync`,{method:'POST',headers:{'Content-Type':'application/json','X-Device-Key':apiKey},body:JSON.stringify(payload)})
    if(!response.ok){if(response.status>=500||response.status===429)throw new Error('Temporary cloud sync failure');continue}
    const write=database.transaction('sync_queue','readwrite');write.objectStore('sync_queue').delete(row.id);await transactionDone(write)
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});clients.forEach(client=>client.postMessage({type:'dexplay-sync-complete',id:row.id}))
  }
  database.close()
}
function idbRequest<T=unknown>(request:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transactionDone(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}

self.addEventListener('sync',event=>{
  const syncEvent=event as ExtendableEvent & {tag:string}
  if(syncEvent.tag==='dexplay-session-sync')syncEvent.waitUntil(flushSessionQueue())
})
self.addEventListener('push',event=>{
  const pushEvent=event as PushEvent
  const payload=pushEvent.data?.json()??{}
  const title=String(payload.title??'DexPlay')
  const body=String(payload.body??'A friendly reminder: time for your practice session!')
  pushEvent.waitUntil(self.registration.showNotification(title,{body,icon:'/icons/icon-192.svg',badge:'/icons/icon-192.svg',tag:'dexplay-daily-session',data:{url:payload.url??'/'}}))
})
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=String((event.notification.data as {url?:string})?.url??'/')
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>'focus' in client);if(existing){void existing.focus();return}
    return self.clients.openWindow(url)
  }))
})
