import React, { useEffect, useState } from 'react';
import { Phone, Video } from 'lucide-react';
import { formatCallDuration } from '../../utils/date';
import { createSafeMeetingRoomName, buildJitsiUrl } from '../../utils/meeting';
import { copyTextToClipboard } from '../../utils/clipboard';

export const TeamMeetingRoom = ({ currentUser, safeAppId }) => {
  const [copied, setCopied] = useState(false);
  const [meetingMode, setMeetingMode] = useState('video');
  const [meetingStartedAt, setMeetingStartedAt] = useState(null);
  const [meetingNow, setMeetingNow] = useState(Date.now());
  const [meetingNotes, setMeetingNotes] = useState('');
  const roomName = createSafeMeetingRoomName('KalpaVriksha_Ops_TeamRoom', safeAppId);
  const meetingUrl = buildJitsiUrl(roomName, currentUser?.name, {
    audioOnly: meetingMode === 'audio',
    muteVideo: meetingMode === 'audio'
  });
  const screenShareUrl = buildJitsiUrl(roomName, currentUser?.name, {
    shareScreen: true,
    muteAudio: true,
    muteVideo: true
  });
  const openMeeting = () => window.open(meetingUrl, '_blank', 'noopener,noreferrer');
  const openScreenShare = () => window.open(screenShareUrl, '_blank', 'noopener,noreferrer');
  const handleCopy = async () => {
    const ok = await copyTextToClipboard(meetingUrl);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1800);
  };
  useEffect(() => {
    try { setMeetingStartedAt(Number(localStorage.getItem('kalpa_team_meeting_started_at') || 0) || null); } catch(e) {}
    try { setMeetingNotes(localStorage.getItem('kalpa_team_meeting_notes') || ''); } catch(e) {}
  }, []);
  useEffect(() => {
    const t = setInterval(() => setMeetingNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const handleStartMeeting = () => {
    const now = Date.now();
    setMeetingStartedAt(now);
    try { localStorage.setItem('kalpa_team_meeting_started_at', String(now)); } catch(e) {}
  };
  const handleEndMeeting = () => {
    setMeetingStartedAt(null);
    try { localStorage.removeItem('kalpa_team_meeting_started_at'); } catch(e) {}
  };
  const handleNotesChange = (e) => {
    const value = e.target.value;
    setMeetingNotes(value);
    try { localStorage.setItem('kalpa_team_meeting_notes', value); } catch(err) {}
  };
  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight flex items-center"><Video className="w-8 h-8 mr-3 text-indigo-500"/> Team Virtual Office</h1>
          <p className="text-slate-500 mt-2 font-medium">Persistent audio/video meeting room for instant collaboration, screen sharing, and team discussions.</p>
          <p className="text-[11px] text-slate-400 font-bold mt-2 uppercase tracking-widest">Camera • Mic • Share Screen • Open in New Tab</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMeetingMode('video')} className={`px-4 py-2 rounded-xl text-xs font-black border transition-colors ${meetingMode === 'video' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Video className="w-4 h-4 inline mr-1.5" /> Video
          </button>
          <button type="button" onClick={() => setMeetingMode('audio')} className={`px-4 py-2 rounded-xl text-xs font-black border transition-colors ${meetingMode === 'audio' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <Phone className="w-4 h-4 inline mr-1.5" /> Audio Only
          </button>
          <button type="button" onClick={handleStartMeeting} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-colors shadow-sm">
            Start Meeting
          </button>
          {meetingStartedAt && <button type="button" onClick={handleEndMeeting} className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-black hover:bg-red-100 transition-colors">End</button>}
          <button type="button" onClick={handleCopy} className="px-4 py-2 bg-white text-indigo-700 border border-indigo-100 rounded-xl text-xs font-black hover:bg-indigo-50 transition-colors">
            {copied ? 'Link Copied' : 'Copy Link'}
          </button>
          <button type="button" onClick={openMeeting} className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors flex items-center w-fit">
            <Video className="w-4 h-4 mr-2" /> Open Meeting
          </button>
          <button type="button" onClick={openScreenShare} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-bold shadow-md hover:bg-slate-800 transition-colors flex items-center w-fit">
            <Video className="w-4 h-4 mr-2" /> Share Screen
          </button>
        </div>
      </div>
      <div className="bg-white border border-indigo-100 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div>
          <p className="text-sm font-extrabold text-slate-800">Team meeting room is always the same for everyone.</p>
          <p className="text-xs font-semibold text-slate-500 mt-1">Meetings now open in a full browser tab for reliable camera, mic and screen sharing. If screen sharing does not start automatically, click the Jitsi Share Screen button in the bottom toolbar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meetingStartedAt && <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-full">Live • {formatCallDuration(meetingStartedAt, meetingNow)}</span>}
          <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-full">Ready</span>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-extrabold text-slate-800 mb-2">Meeting notes</p>
          <textarea value={meetingNotes} onChange={handleNotesChange} rows={3} placeholder="Write quick discussion points, decisions, or action items here..." className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none" />
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">Saved locally in this browser; does not affect other modules.</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-extrabold text-indigo-900 mb-2">Quick meeting flow</p>
          <ul className="text-xs font-semibold text-indigo-700 space-y-1.5">
            <li>1. Click Start Meeting.</li>
            <li>2. Allow mic/camera permission.</li>
            <li>3. Use Jitsi toolbar for screen share.</li>
            <li>4. Copy link for users joining from another browser.</li>
          </ul>
        </div>
      </div>
      <div className="w-full min-h-[360px] bg-slate-900 rounded-3xl overflow-hidden shadow-xl border-4 border-slate-800 relative flex items-center justify-center p-6 text-center">
        <div className="max-w-xl">
          <div className="w-16 h-16 rounded-2xl bg-white/10 text-white flex items-center justify-center mx-auto mb-4">
            <Video className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-white">Open meeting in a new tab</h2>
          <p className="text-sm font-semibold text-slate-300 mt-3">Embedded meetings can hide or block screen sharing in some browsers. Use the buttons below for the full Jitsi toolbar.</p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <button type="button" onClick={openMeeting} className="px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 shadow-md">Open Meeting</button>
            <button type="button" onClick={openScreenShare} className="px-5 py-3 rounded-xl bg-white text-slate-900 text-sm font-black hover:bg-slate-100 shadow-md">Share Screen</button>
          </div>
        </div>
      </div>
    </div>
  );
};

