/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { startOperation } from './operationLog'

declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST:Parameters<typeof precacheAndRoute>[0]}
const API = import.meta.env.VITE_API_URL || '/api'
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(({request,url})=>request.destination==='image'||/\.(pdf|mp4|webm)$/i.test(url.pathname),
  new CacheFirst({cacheName:'dexplay-resources',plugins:[new ExpirationPlugin({maxEntries:80,maxAgeSeconds:60*60*24*365,purgeOnQuotaError:true})]}))

function openDexDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('dexplay-production',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function flushSessionQueue(){
  const flushOperation=startOperation('sync.background_flush')
  const database=await openDexDb();const tx=database.transaction(['settings','sync_queue'],'readonly')
  const settings=await idbRequest(tx.objectStore('settings').get('api-key')) as {value?:string}|undefined
  const apiKey=settings?.value
  if(!apiKey){database.close();flushOperation.complete({source:'background_sync',status:'no_device_key'});return}
  const rows=await idbRequest(tx.objectStore('sync_queue').getAll()) as {id:string;payload:Record<string,unknown>;synced:boolean;profile_id?:string}[]
  await transactionDone(tx)
  const pendingRows=rows.filter(item=>!item.synced)
  flushOperation.event('queue_loaded',{source:'background_sync',item_count:pendingRows.length})
  for(const row of pendingRows){
    const operation=startOperation('sync.background_item')
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
    if(row.payload.ai_consent&&!currentlyConsented)operation.event('ai_skipped_consent_off',{source:'background_sync'})
    let response:Response
    try{
      response=await fetch(`${API}/sync`,{method:'POST',headers:{'Content-Type':'application/json','X-Device-Key':apiKey,'X-Request-ID':operation.requestId},body:JSON.stringify(payload)})
    }catch(error){
      operation.fail(error,{source:'background_sync'})
      flushOperation.fail(error,{source:'background_sync'})
      throw error
    }
    if(!response.ok){
      operation.event('response_rejected',{source:'background_sync',status_code:response.status})
      if(response.status>=500||response.status===429){
        const error=new Error('Temporary cloud sync failure')
        operation.fail(error,{source:'background_sync',status_code:response.status})
        flushOperation.fail(error,{source:'background_sync',status_code:response.status})
        throw error
      }
      operation.complete({source:'background_sync',status:'retained_after_rejection',status_code:response.status})
      continue
    }
    const write=database.transaction('sync_queue','readwrite');write.objectStore('sync_queue').delete(row.id);await transactionDone(write)
    operation.complete({source:'background_sync',status_code:response.status})
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});clients.forEach(client=>client.postMessage({type:'dexplay-sync-complete',id:row.id}))
  }
  database.close()
  flushOperation.complete({source:'background_sync',item_count:pendingRows.length})
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
