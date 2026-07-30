import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { Button, ModalShell, TextInput, ToastViewport } from './designSystem.jsx';
import { resolveUiRequest, UI_FEEDBACK_EVENT } from '../../services/uiFeedback.js';

const toneMeta = {
  success: { category: 'Success', type: 'success', icon: CheckCircle },
  error: { category: 'Error', type: 'error', priority: 'critical', icon: XCircle },
  warning: { category: 'Warning', type: 'urgent', icon: AlertTriangle },
  info: { category: 'Update', type: 'info', icon: Info },
};

export const FeedbackHost = () => {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const handle = (event) => {
      const detail = event?.detail || {};
      if (detail.kind === 'toast') {
        const tone = toneMeta[detail.tone] || toneMeta.info;
        setToasts((prev) => [{ ...detail, ...tone, text: detail.message, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
        return;
      }
      if (detail.kind === 'confirm' || detail.kind === 'prompt') {
        setInputValue(detail.defaultValue == null ? '' : String(detail.defaultValue));
        setDialog(detail);
      }
    };
    window.addEventListener(UI_FEEDBACK_EVENT, handle);
    return () => window.removeEventListener(UI_FEEDBACK_EVENT, handle);
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [dialog?.id]);

  const close = (value) => {
    if (!dialog) return;
    resolveUiRequest(dialog.id, value);
    setDialog(null);
    setInputValue('');
  };

  const toastItems = useMemo(() => toasts.map((item) => ({
    ...item,
    title: item.title || item.category,
    message: item.message || item.text,
  })), [toasts]);

  return (
    <>
      <ToastViewport toasts={toastItems} onDismiss={(id) => setToasts((prev) => prev.filter((item) => String(item.id) !== String(id)))} max={4} />
      <ModalShell
        isOpen={Boolean(dialog)}
        title={dialog?.title || (dialog?.kind === 'prompt' ? 'Enter details' : 'Please confirm')}
        eyebrow={dialog?.kind === 'prompt' ? 'Secure input' : 'Confirmation'}
        onClose={() => close(dialog?.kind === 'confirm' ? false : null)}
        size="md"
        initialFocusSelector={dialog?.kind === 'prompt' ? 'input' : 'button[data-primary="true"]'}
        footer={dialog ? (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <Button variant="secondary" onClick={() => close(dialog.kind === 'confirm' ? false : null)}>Cancel</Button>
            <Button data-primary="true" variant={dialog.tone === 'danger' ? 'danger' : 'indigo'} onClick={() => close(dialog.kind === 'prompt' ? inputValue : true)}>
              {dialog.confirmLabel || (dialog.kind === 'prompt' ? 'Continue' : 'Confirm')}
            </Button>
          </div>
        ) : null}
      >
        {dialog ? (
          <div className="space-y-4">
            <p className="text-sm font-bold leading-6 text-slate-600 whitespace-pre-line">{dialog.message}</p>
            {dialog.kind === 'prompt' ? (
              <TextInput
                ref={inputRef}
                type={dialog.inputType || 'text'}
                value={inputValue}
                placeholder={dialog.placeholder || ''}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); close(inputValue); }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </ModalShell>
    </>
  );
};

export default FeedbackHost;
