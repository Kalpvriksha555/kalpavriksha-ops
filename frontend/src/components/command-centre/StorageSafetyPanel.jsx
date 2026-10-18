import React, {useCallback, useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle, HardDrive, RefreshCw, ShieldCheck} from 'lucide-react';
import {getStorageSafetyApi, requestStorageSafetyActionApi} from '../../services/systemHealthService';

function readable(date) {return date ? new Date(date).toLocaleString() : 'Not yet verified';}
export function StorageAlertNavBadge() {
  const [count,setCount]=useState(0);
  useEffect(()=>{
    let mounted=true;
    const check=()=>getStorageSafetyApi().then(x=>{if(mounted)setCount(Number(x.warningCount||0));}).catch(()=>{if(mounted)setCount(0);});
    check();
    const id=setInterval(check,120000);
    return ()=>{mounted=false;clearInterval(id);};
  },[]);
  if (!count) return null;
  return <span role="status" aria-label={count+' unresolved storage and backup alerts'}
    title={count+' unresolved storage and backup alerts'}
    className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-red-600 px-1 text-white text-[10px] font-black">
    {count>9?'9+':count}
  </span>;
}
export default function StorageSafetyPanel() {
  const [report,setReport]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState('');
  const refresh=useCallback(async()=>{
    setLoading(true);
    try{setReport(await getStorageSafetyApi());setError('');}
    catch(e){setError(e.message||'Unable to check storage safety.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{refresh();const t=setInterval(refresh,90000);return()=>clearInterval(t);},[refresh]);
  const request=async(action,label)=>{
    if (!window.confirm('Request '+label+'? This starts a guarded background service; it does not restore or delete customer data.')) return;
    setBusy(action);setError('');setNotice('');
    try{const r=await requestStorageSafetyActionApi(action);setNotice(r.message||'Request accepted; completion is pending.');await refresh();}
    catch(e){setError(e.message||'Maintenance request failed.');}
    finally{setBusy('');}
  };
  const disk=report?.disk||{},backup=report?.backup||{},alerts=report?.alerts||[];
  const enabled=!!report?.maintenance?.enabled;
  const button='rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50';
  return <section className="space-y-4" aria-label="Storage Safety and Recovery">
    <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div><h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600"/>Storage Safety &amp; Recovery</h2>
          <p className="text-sm text-slate-500 mt-2">Admin-only portal alerts and guarded maintenance requests. No email alerts are sent.</p>
          <p className="text-xs text-slate-500 mt-1">Last checked: {readable(report?.checkedAt)}</p></div>
        <button type="button" onClick={refresh} disabled={loading} className={button+' bg-indigo-50 text-indigo-700 flex gap-2 items-center'}>
          <RefreshCw className="w-4 h-4"/>{loading?'Checking…':'Refresh'}</button>
      </div>
    </div>
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
    {notice&&<div role="status" className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-bold text-indigo-700">{notice}</div>}
    {report&&<>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-4 border border-slate-100"><p className="text-xs font-bold text-slate-500">VPS storage</p><p className="text-2xl font-black text-slate-800 flex items-center gap-2 mt-2"><HardDrive className="w-5 h-5"/>{disk.usedPercent}% used</p><p className="text-sm text-slate-500">{disk.freeGiB} GiB available</p></div>
        <div className="rounded-2xl bg-white p-4 border border-slate-100"><p className="text-xs font-bold text-slate-500">Verified full backups</p><p className="text-2xl font-black mt-2">{backup.verifiedFullCount}</p><p className="text-xs text-slate-500">{readable(backup.latestFull?.createdAt)}</p></div>
        <div className="rounded-2xl bg-white p-4 border border-slate-100"><p className="text-xs font-bold text-slate-500">Verified database backups</p><p className="text-2xl font-black mt-2">{backup.verifiedDatabaseCount}</p><p className="text-xs text-slate-500">{readable(backup.latestDatabase?.createdAt)}</p></div>
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-100 space-y-3">
        <h3 className="text-lg font-black">Storage and backup alerts ({report.warningCount||0})</h3>
        {!alerts.length&&<p className="text-sm text-emerald-700 flex items-center gap-2"><CheckCircle className="w-4 h-4"/>All monitored checks healthy</p>}
        {alerts.map(a=><div key={a.id} className={'rounded-xl border p-4 '+(a.severity==='critical'?'bg-red-50 border-red-200 text-red-800':a.severity==='warning'?'bg-amber-50 border-amber-200 text-amber-900':'bg-slate-50 border-slate-200 text-slate-700')}>
          <h4 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>{a.title}</h4><p className="text-sm mt-1">{a.message}</p><p className="text-[10px] uppercase mt-2">{a.severity} • {a.id}</p>
        </div>)}
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-100 space-y-3">
        <h3 className="font-black">Safe resolution controls</h3>
        {!enabled&&<p role="status" className="text-sm text-amber-700">Maintenance requests are disabled until explicitly enabled on the VPS.</p>}
        <p className="text-xs text-slate-500">Actions are limited to existing systemd-managed backup and scratch housekeeping services. They do not mark a problem resolved until a fresh health check passes.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button+' bg-indigo-600 text-white'} disabled={!enabled||loading||!!busy} onClick={()=>request('FULL_BACKUP','a verified full backup')}>{busy==='FULL_BACKUP'?'Requesting…':'Request verified full backup'}</button>
          <button type="button" className={button+' bg-slate-100 text-slate-700'} disabled={!enabled||loading||!!busy} onClick={()=>request('DATABASE_BACKUP','a database backup')}>Request database backup</button>
          <button type="button" className={button+' bg-slate-100 text-slate-700'} disabled={!enabled||loading||!!busy} onClick={()=>request('SAFE_SCRATCH_CLEANUP','safe scratch housekeeping')}>Safe scratch housekeeping</button>
        </div>
        <p className="text-xs text-slate-500">Browser-based database restoration, customer-file deletion and bulk backup deletion are prohibited.</p>
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-100 text-sm text-slate-600 space-y-2">
        <h3 className="font-black text-slate-800">Recovery evidence</h3>
        <p>Alert delivery: <strong>Admin portal only</strong>.</p>
        <p>Rotation: <strong>{backup.rotationEnabled?'Enabled':'Disabled'}</strong>. Protected backup pinned: <strong>{backup.pinnedBackupSet?'Yes':'No'}</strong>.</p>
        <p>Last isolated application restore test: <strong>{readable(report.restore?.lastPassed?.completedAt)}</strong>.</p>
        {!!backup.stalePartialCount&&<p>{backup.stalePartialCount} historical incomplete export(s) are preserved for separate inspection.</p>}
      </div>
    </>}
  </section>;
}
