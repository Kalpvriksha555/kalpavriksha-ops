import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Image as ImageIcon, Maximize2, Minus, Move, Plus, RefreshCcw, RotateCw, Search, X } from 'lucide-react';
import { fetchProjectFilePreview, getProjectFileKind, getProjectFilePreviewUrl, releaseProjectFilePreview } from '../../services/fileService';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const SESSION_KEY_PREFIX = 'kalpa_unified_file_viewer_state_v2';
const formatBytes = (bytes = 0) => {
  const value = Number(bytes || 0);
  if (!value) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const getFileTitle = (file = {}) => file?.name || file?.fileName || file?.filename || 'File Preview';
const getViewerKey = (file = {}) => String(file?._previewKey || file?.fileId || file?.id || file?.previewUrl || file?.url || file?.downloadUrl || getFileTitle(file));
const readSessionState = (key) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${SESSION_KEY_PREFIX}:${key}`) || '{}');
    if (!saved || typeof saved !== 'object') return null;
    return saved;
  } catch { return null; }
};
const writeSessionState = (key, value) => {
  try { sessionStorage.setItem(`${SESSION_KEY_PREFIX}:${key}`, JSON.stringify(value)); } catch {}
};

export const UnifiedFileViewer = ({ file, onClose, onDownload }) => {
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState({ zoom: 1, rotation: 0, fit: 'page', panX: 0, panY: 0, page: 1, scrollTop: 0 });
  const [textSearch, setTextSearch] = useState('');
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0, pinchDistance: 0, pinchZoom: 1 });
  const abortRef = useRef(null);
  const contentRef = useRef(null);
  const searchInputRef = useRef(null);
  const title = getFileTitle(file || {});
  const requestedKey = getViewerKey(file || {});
  const fileKind = useMemo(() => getProjectFileKind(file || {}), [file]);
  const isOpen = Boolean(file);

  const persistCurrentState = useCallback(() => {
    if (!requestedKey || !contentRef.current) return;
    writeSessionState(requestedKey, { ...view, scrollTop: contentRef.current.scrollTop || view.scrollTop || 0 });
  }, [requestedKey, view]);

  const close = useCallback(() => {
    persistCurrentState();
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    setPreview((current) => {
      releaseProjectFilePreview(current);
      return null;
    });
    setView({ zoom: 1, rotation: 0, fit: 'page', panX: 0, panY: 0, page: 1, scrollTop: 0 });
    setTextSearch('');
    onClose?.();
  }, [onClose, persistCurrentState]);

  const zoomIn = useCallback(() => setView((v) => ({ ...v, fit: 'custom', zoom: clamp(Number((v.zoom + 0.25).toFixed(2)), 0.25, 4) })), []);
  const zoomOut = useCallback(() => setView((v) => ({ ...v, fit: 'custom', zoom: clamp(Number((v.zoom - 0.25).toFixed(2)), 0.25, 4) })), []);
  const rotate = useCallback(() => setView((v) => ({ ...v, rotation: (Number(v.rotation || 0) + 90) % 360 })), []);
  const fitPage = useCallback(() => setView((v) => ({ ...v, fit: 'page', zoom: 1, panX: 0, panY: 0 })), []);
  const fitWidth = useCallback(() => setView((v) => ({ ...v, fit: 'width', zoom: 1.25, panX: 0, panY: 0 })), []);
  const previousPage = useCallback(() => {
    const el = contentRef.current;
    if (el) el.scrollBy({ top: -Math.max(280, el.clientHeight * 0.88), behavior: 'smooth' });
    setView((v) => ({ ...v, page: Math.max(1, Number(v.page || 1) - 1) }));
  }, []);
  const nextPage = useCallback(() => {
    const el = contentRef.current;
    if (el) el.scrollBy({ top: Math.max(280, el.clientHeight * 0.88), behavior: 'smooth' });
    setView((v) => ({ ...v, page: Number(v.page || 1) + 1 }));
  }, []);
  const resetPan = useCallback(() => setView((v) => ({ ...v, fit: 'page', zoom: 1, panX: 0, panY: 0 })), []);
  const download = useCallback(() => onDownload?.(file || preview?.file), [file, onDownload, preview?.file]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      const key = event.key;
      const target = event.target;
      const isTyping = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(target.tagName || '').toUpperCase());
      if (key === 'Escape') { event.preventDefault(); close(); return; }
      if ((event.ctrlKey || event.metaKey) && key === '0') { event.preventDefault(); fitPage(); return; }
      if ((event.ctrlKey || event.metaKey) && (key === '+' || key === '=')) { event.preventDefault(); zoomIn(); return; }
      if ((event.ctrlKey || event.metaKey) && key === '-') { event.preventDefault(); zoomOut(); return; }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'f') { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (isTyping) return;
      if (key === 'ArrowLeft' || key === 'PageUp') { event.preventDefault(); previousPage(); return; }
      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') { event.preventDefault(); nextPage(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, fitPage, isOpen, nextPage, previousPage, zoomIn, zoomOut]);

  useEffect(() => {
    if (!file) return undefined;
    const kind = getProjectFileKind(file);
    const fallbackUrl = getProjectFilePreviewUrl(file);
    const saved = readSessionState(requestedKey);
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setView({ zoom: clamp(Number(saved?.zoom || 1), 0.25, 4), rotation: Number(saved?.rotation || 0), fit: saved?.fit || 'page', panX: Number(saved?.panX || 0), panY: Number(saved?.panY || 0), page: Math.max(1, Number(saved?.page || 1)), scrollTop: Number(saved?.scrollTop || 0) });
    setTextSearch('');
    setPreview((current) => {
      releaseProjectFilePreview(current);
      return { file, kind, title, loading: true, error: '', url: '', objectUrl: '' };
    });

    fetchProjectFilePreview(file, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        abortRef.current = null;
        setPreview({
          file,
          kind: result.kind || kind,
          title,
          loading: false,
          error: '',
          url: result.url,
          objectUrl: result.objectUrl || result.url,
          sourceUrl: result.sourceUrl,
          mimeType: result.mimeType,
          size: result.size,
          fromCache: Boolean(result.fromCache),
          text: result.text,
          metadataOnly: Boolean(result.metadataOnly),
          name: result.name,
        });
        requestAnimationFrame(() => {
          const el = contentRef.current;
          if (el && saved?.scrollTop) el.scrollTop = Number(saved.scrollTop || 0);
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        abortRef.current = null;
        setPreview({
          file,
          kind,
          title,
          loading: false,
          error: error?.message || 'Preview could not be loaded.',
          url: '',
          objectUrl: '',
          sourceUrl: '',
        });
      });

    return () => { controller.abort(); };
  }, [file, requestedKey, title]);

  useEffect(() => {
    if (!isOpen || !requestedKey) return undefined;
    const id = window.setTimeout(() => writeSessionState(requestedKey, { ...view, scrollTop: contentRef.current?.scrollTop || view.scrollTop || 0 }), 250);
    return () => window.clearTimeout(id);
  }, [isOpen, requestedKey, view]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isOpen]);

  useEffect(() => () => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    setPreview((current) => {
      releaseProjectFilePreview(current);
      return null;
    });
  }, []);

  if (!isOpen || typeof document === 'undefined') return null;

  const active = preview || { file, kind: fileKind, title, loading: true };
  const isImage = active.kind === 'image';
  const isPdf = active.kind === 'pdf';
  const isText = active.kind === 'text';
  const isOffice = active.kind === 'office';
  const isCad = active.kind === 'cad';
  const zoomPercent = Math.round((view.zoom || 1) * 100);
  const openUrl = active.url || '';
  const sourcePreviewUrl = active.sourceUrl || getProjectFilePreviewUrl(file || {});
  const pdfViewerUrl = useMemo(() => {
    if (!isPdf || !active.url) return active.url || '';
    const base = String(active.url || '').split('#')[0];
    const viewMode = view.fit === 'page' ? 'Fit' : 'FitH';
    const zoomValue = view.fit === 'custom' ? `&zoom=${Math.max(25, Math.min(400, zoomPercent))}` : '';
    return `${base}#toolbar=0&navpanes=0&scrollbar=1&view=${viewMode}${zoomValue}`;
  }, [active.url, isPdf, view.fit, zoomPercent]);
  const searchNeedle = textSearch.trim().toLowerCase();
  const textMatches = searchNeedle && isText ? (String(active.text || '').toLowerCase().match(new RegExp(searchNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;

  const getTouchDistance = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const [a, b] = touches;
    return Math.hypot((a.clientX || 0) - (b.clientX || 0), (a.clientY || 0) - (b.clientY || 0));
  };
  const startPan = (clientX, clientY) => {
    dragRef.current = { ...dragRef.current, active: true, startX: clientX, startY: clientY, panX: view.panX || 0, panY: view.panY || 0 };
  };
  const movePan = (clientX, clientY) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    setView((v) => ({ ...v, fit: 'custom', panX: drag.panX + clientX - drag.startX, panY: drag.panY + clientY - drag.startY }));
  };
  const stopPan = () => { dragRef.current = { ...dragRef.current, active: false, pinchDistance: 0 }; };
  const handleWheel = (event) => {
    if (!(isImage || isPdf) || !event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    setView((v) => ({ ...v, fit: 'custom', zoom: clamp(Number((v.zoom + delta).toFixed(2)), 0.25, 4) }));
  };
  const handleTouchStart = (event) => {
    if (!isImage) return;
    if (event.touches.length === 2) {
      dragRef.current = { ...dragRef.current, pinchDistance: getTouchDistance(event.touches), pinchZoom: view.zoom || 1, active: false };
      return;
    }
    if (event.touches.length === 1) startPan(event.touches[0].clientX, event.touches[0].clientY);
  };
  const handleTouchMove = (event) => {
    if (!isImage) return;
    if (event.touches.length === 2) {
      const distance = getTouchDistance(event.touches);
      const base = dragRef.current.pinchDistance || distance;
      const nextZoom = clamp(Number(((dragRef.current.pinchZoom || 1) * (distance / Math.max(base, 1))).toFixed(2)), 0.25, 4);
      setView((v) => ({ ...v, fit: 'custom', zoom: nextZoom }));
      return;
    }
    if (event.touches.length === 1) movePan(event.touches[0].clientX, event.touches[0].clientY);
  };
  const onContentScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const estimatedPage = Math.max(1, Math.round((el.scrollTop || 0) / Math.max(240, el.clientHeight * 0.88)) + 1);
    setView((v) => (Math.abs(Number(v.scrollTop || 0) - el.scrollTop) < 25 && Number(v.page || 1) === estimatedPage ? v : { ...v, scrollTop: el.scrollTop || 0, page: estimatedPage }));
  };

  return createPortal((
    <div className="kalpa-unified-viewer fixed inset-0 z-[2147483647] bg-slate-950/85 backdrop-blur-sm p-0 sm:p-5 flex items-center justify-center animate-in fade-in duration-150" style={{ zIndex: 2147483647 }} role="dialog" aria-modal="true">
      <div className="kalpa-unified-viewer-panel bg-white w-full max-w-7xl h-[100dvh] sm:h-[94vh] rounded-none sm:rounded-[1.75rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 relative" style={{ zIndex: 2147483647 }}>
        <div className="kalpa-unified-viewer-header px-3 sm:px-5 py-2.5 border-b border-slate-100 bg-slate-50/95 relative z-[2]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0 flex items-center gap-3 flex-1 pr-1">
              <div className={`${isImage ? 'bg-blue-50 text-blue-600 border-blue-100' : isText ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : isOffice ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-red-50 text-red-600 border-red-100'} w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center border shrink-0`}>
                {isImage ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400">{isImage ? 'Image Preview' : isPdf ? 'PDF Preview' : 'Unified Preview'} {active.fromCache ? '• Cached' : ''}</p>
                <h3 className="text-sm sm:text-base font-black text-slate-900 truncate max-w-[34vw] sm:max-w-[24vw] lg:max-w-[30vw]">{active.title || title}</h3>
              </div>
            </div>

            <div className="kalpa-unified-viewer-actions flex items-center justify-end gap-1.5 shrink-0 flex-wrap max-w-[calc(100%-220px)] sm:max-w-[70vw] pr-12">
              {!active.loading && !active.error && (isText || isPdf) && (
                <div className="hidden xl:flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1 shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <input ref={searchInputRef} value={textSearch} onChange={(event) => setTextSearch(event.target.value)} placeholder={isPdf ? 'Ctrl+F in PDF' : 'Search text'} className="w-32 text-xs font-bold outline-none bg-transparent text-slate-600" />
                  {isText && textSearch && <span className="text-[10px] font-black text-slate-400">{textMatches}</span>}
                </div>
              )}
              {!active.loading && !active.error && (isImage || isPdf) && (
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shrink-0">
                  {isPdf && <button type="button" onClick={previousPage} className="hidden lg:flex px-2 py-1 rounded-lg text-xs font-black hover:bg-slate-100" title="Previous page"><ChevronLeft className="w-3.5 h-3.5" /></button>}
                  {isPdf && <span className="hidden lg:inline text-[11px] font-black text-slate-500 min-w-10 text-center">{view.page || 1}</span>}
                  {isPdf && <button type="button" onClick={nextPage} className="hidden lg:flex px-2 py-1 rounded-lg text-xs font-black hover:bg-slate-100" title="Next page"><ChevronRight className="w-3.5 h-3.5" /></button>}
                  <button type="button" onClick={zoomOut} className="px-2.5 py-2 rounded-lg text-xs font-black hover:bg-slate-100 flex items-center shrink-0" title="Zoom out"><Minus className="w-4 h-4" /></button>
                  <span className="text-[11px] sm:text-xs font-black text-slate-600 min-w-12 text-center">{zoomPercent}%</span>
                  <button type="button" onClick={zoomIn} className="px-2.5 py-2 rounded-lg text-xs font-black hover:bg-slate-100 flex items-center shrink-0" title="Zoom in"><Plus className="w-4 h-4" /></button>
                  <button type="button" onClick={fitWidth} className="px-3 py-2 rounded-lg text-xs font-black hover:bg-slate-100 whitespace-nowrap" title="Fit width">Fit Width</button>
                  <button type="button" onClick={fitPage} className="px-3 py-2 rounded-lg text-xs font-black hover:bg-slate-100 whitespace-nowrap" title="Fit page">Fit Page</button>
                  <button type="button" onClick={rotate} className="px-2.5 py-2 rounded-lg text-xs font-black hover:bg-slate-100 flex items-center gap-1" title="Rotate"><RotateCw className="w-4 h-4" /><span className="hidden sm:inline">Rotate</span></button>
                  {isImage && <button type="button" onClick={resetPan} className="hidden sm:flex px-2.5 py-2 rounded-lg text-xs font-black hover:bg-slate-100" title="Reset pan"><Move className="w-4 h-4" /></button>}
                </div>
              )}
              {openUrl && !active.loading && !active.error && <button type="button" onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')} className="hidden sm:flex text-xs font-black text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl items-center gap-1.5 shrink-0"><ExternalLink className="w-3.5 h-3.5" /> Open</button>}
              <button type="button" onClick={download} className="hidden sm:flex text-xs font-black text-indigo-700 bg-white hover:bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl items-center gap-1.5 shrink-0"><Download className="w-3.5 h-3.5" /> Download</button>
              <button type="button" onClick={close} className="kalpa-viewer-close-button absolute right-3 top-3 sm:right-4 sm:top-3 p-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 shadow-sm flex items-center justify-center z-[5]" title="Close" aria-label="Close preview"><X className="w-5 h-5" /></button>
            </div>
          </div>
        </div>

        <div ref={contentRef} onScroll={onContentScroll} className="kalpa-unified-viewer-content flex-1 bg-slate-100 min-h-0 overflow-auto" onWheel={handleWheel}>
          {active.loading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-500">
              <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-indigo-500 animate-spin" />
              <p className="text-sm font-black">Preparing preview...</p>
              <div className="w-72 max-w-[80vw] h-3 rounded-full bg-slate-200 overflow-hidden"><div className="w-1/2 h-full bg-indigo-500 animate-pulse rounded-full" /></div>
            </div>
          ) : active.error ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <div className="max-w-xl w-full bg-white rounded-3xl border border-rose-100 shadow-sm p-6 text-center">
                <AlertCircle className="w-10 h-10 mx-auto text-rose-500 mb-3" />
                <h4 className="font-black text-slate-900 text-lg">Preview could not open</h4>
                <p className="text-sm font-semibold text-slate-500 mt-2 break-words">{active.error}</p>
                <div className="mt-5 flex flex-col sm:flex-row justify-center gap-2">
                  <button type="button" onClick={download} className="text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-4 py-2 rounded-xl">Download file</button>
                </div>
              </div>
            </div>
          ) : isImage ? (
            <div
              className="h-full min-h-0 w-full flex items-center justify-center bg-slate-950 overflow-hidden p-2 sm:p-4 touch-none cursor-grab active:cursor-grabbing"
              onMouseDown={(event) => startPan(event.clientX, event.clientY)}
              onMouseMove={(event) => movePan(event.clientX, event.clientY)}
              onMouseUp={stopPan}
              onMouseLeave={stopPan}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={stopPan}
            >
              {active.url ? (
                <img
                  src={active.url}
                  alt={active.title || title}
                  onError={() => setPreview((current) => ({ ...(current || {}), loading: false, error: 'Image preview could not be loaded from the saved file link.' }))}
                  style={{ transform: `translate(${view.panX || 0}px, ${view.panY || 0}px) scale(${view.zoom}) rotate(${view.rotation}deg)`, transition: dragRef.current.active ? 'none' : 'transform 120ms ease', maxWidth: 'calc(100vw - 64px)', maxHeight: 'calc(100vh - 150px)' }}
                  className="object-contain rounded-xl shadow-2xl select-none pointer-events-none bg-white"
                  draggable="false"
                />
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm font-bold text-slate-500">Image preview link is missing.</div>
              )}
            </div>
          ) : isPdf ? (
            <div className="w-full h-full bg-slate-900 overflow-hidden flex items-stretch justify-stretch">
              {active.url ? (
                <div className="w-full h-full bg-slate-900 overflow-hidden" style={{ transform: `rotate(${view.rotation}deg)`, transformOrigin: 'center center' }}>
                  <iframe
                    key={`${String(active.url || '').slice(0, 80)}-${view.fit}-${zoomPercent}-${view.rotation}`}
                    title={active.title || title}
                    src={pdfViewerUrl}
                    className="w-full h-full bg-white border-0 block"
                    style={{ minHeight: '100%', minWidth: '100%' }}
                  />
                </div>
              ) : (
                <div className="m-auto bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm font-bold text-slate-500">PDF preview link is missing.</div>
              )}
            </div>
          ) : isText ? (
            <div className="w-full min-h-full bg-slate-950 p-4 sm:p-6">
              <pre className="min-h-full whitespace-pre-wrap break-words rounded-2xl bg-slate-900 text-slate-100 border border-slate-700 p-4 text-xs sm:text-sm leading-6 font-mono">{active.text || 'Text preview is empty.'}</pre>
            </div>
          ) : isOffice ? (
            <div className="w-full min-h-full flex items-center justify-center p-6">
              <div className="max-w-2xl w-full bg-white rounded-3xl p-6 border border-amber-100 text-center shadow-sm">
                <FileText className="w-12 h-12 mx-auto text-amber-500 mb-3" />
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-500">Office file preview</p>
                <h4 className="font-black text-slate-900 text-lg mt-1">{active.title || title}</h4>
                <p className="text-sm font-semibold text-slate-500 mt-2">Office files are kept inside the unified preview flow without triggering download. Use Open tab for browser-supported rendering or Download for local editing.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-left text-xs font-bold text-slate-500">
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100"><span className="block text-slate-400 uppercase text-[10px]">Type</span>{active.mimeType || 'Office document'}</div>
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100"><span className="block text-slate-400 uppercase text-[10px]">Size</span>{formatBytes(active.size)}</div>
                </div>
                <div className="mt-5 flex flex-col sm:flex-row justify-center gap-2">
                  {openUrl && <button type="button" onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')} className="text-xs font-black text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-xl">Open in new tab</button>}
                  <button type="button" onClick={download} className="text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-4 py-2 rounded-xl">Download file</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full min-h-full flex items-center justify-center p-6">
              <div className="max-w-2xl w-full bg-white rounded-3xl p-6 border text-center shadow-sm">
                <FileText className="w-12 h-12 mx-auto text-slate-400 mb-3" />
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{isCad ? 'CAD metadata preview' : 'Metadata preview'}</p>
                <h4 className="font-black text-slate-900 text-lg mt-1">{active.title || title}</h4>
                <p className="text-sm font-semibold text-slate-500 mt-2">{isCad ? 'DWG/CAD drawings need a dedicated CAD app. Preview shows safe metadata here without forcing a download.' : 'This file type cannot be rendered safely in the browser yet. Preview shows metadata without forcing a download.'}</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left text-xs font-bold text-slate-500">
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100"><span className="block text-slate-400 uppercase text-[10px]">File</span>{active.title || title}</div>
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100"><span className="block text-slate-400 uppercase text-[10px]">Type</span>{active.mimeType || active.kind || 'File'}</div>
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100"><span className="block text-slate-400 uppercase text-[10px]">Size</span>{formatBytes(active.size)}</div>
                </div>
                <button type="button" onClick={download} className="mt-5 text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl">Download file</button>
              </div>
            </div>
          )}
        </div>

        <div className="kalpa-unified-viewer-footer sm:hidden px-3 py-2.5 bg-white border-t border-slate-100">
          <div className="kalpa-mobile-preview-toolbar flex gap-2 overflow-x-auto pb-1">
            {(isImage || isPdf) && !active.loading && !active.error && <>
              <button type="button" onClick={zoomOut} className="shrink-0 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl flex items-center justify-center gap-1"><Minus className="w-3.5 h-3.5" /> Out</button>
              <button type="button" onClick={zoomIn} className="shrink-0 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> In</button>
              <button type="button" onClick={fitPage} className="shrink-0 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">Fit</button>
              <button type="button" onClick={rotate} className="shrink-0 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl flex items-center justify-center gap-1"><RefreshCcw className="w-3.5 h-3.5" /> Rotate</button>
            </>}
            {openUrl && !active.loading && !active.error && <button type="button" onClick={() => window.open(openUrl, '_blank', 'noopener,noreferrer')} className="shrink-0 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl flex items-center justify-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> Open</button>}
            <button type="button" onClick={download} className="shrink-0 text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-2 rounded-xl flex items-center justify-center gap-1"><Download className="w-3.5 h-3.5" /> Download</button>
          </div>
        </div>
        </div>
      </div>
    </div>
  ), document.body);
};

export default UnifiedFileViewer;
