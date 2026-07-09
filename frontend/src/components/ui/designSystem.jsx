import React from 'react';
import { AlertTriangle, Loader2, X, Inbox, RefreshCw, CheckCircle, AlertCircle, Info, Bell, MessageSquare } from 'lucide-react';
import { PortalLayer, LAYER_Z } from './LayerPortal';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') {
      console.error('[Kalpavriksha Ops] UI boundary caught an error', error, info);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-[2rem] border-2 border-red-100 bg-white shadow-2xl p-8 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">This screen failed safely. Refresh the page and continue working.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg hover:bg-slate-800"
          >
            Refresh page
          </button>
        </div>
      </div>
    );
  }
}

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  className = '',
  type = 'button',
  ...props
}) => {
  const variants = {
    primary: 'bg-slate-900 text-white shadow-xl shadow-slate-200 hover:bg-slate-800 border-slate-900',
    secondary: 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-sm',
    soft: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
    indigo: 'bg-indigo-600 text-white border-indigo-600 shadow-xl shadow-indigo-100 hover:bg-indigo-700',
    success: 'bg-emerald-600 text-white border-emerald-600 shadow-xl shadow-emerald-100 hover:bg-emerald-700',
    warning: 'bg-amber-500 text-white border-amber-500 shadow-xl shadow-amber-100 hover:bg-amber-600',
    danger: 'bg-red-600 text-white border-red-600 shadow-xl shadow-red-100 hover:bg-red-700',
    ghost: 'bg-transparent text-slate-600 border-transparent hover:bg-slate-100',
  };
  const sizes = {
    xs: 'px-2.5 py-1.5 text-xs rounded-xl gap-1.5',
    sm: 'px-3 py-2 text-xs rounded-xl gap-2',
    md: 'px-4 py-2.5 text-sm rounded-2xl gap-2',
    lg: 'px-5 py-3.5 text-base rounded-2xl gap-2.5',
    xl: 'px-6 py-4 text-lg rounded-2xl gap-3',
    icon: 'h-11 w-11 p-0 rounded-2xl',
  };
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      className={cx(
        'kalpa-ui-button inline-flex items-center justify-center border-2 font-black transition-all duration-200 outline-none focus-visible:ring-4 focus-visible:ring-indigo-100',
        sizes[size] || sizes.md,
        variants[variant] || variants.primary,
        isDisabled && 'opacity-60 cursor-not-allowed hover:translate-y-0',
        !isDisabled && 'active:scale-[0.98]',
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : LeftIcon ? <LeftIcon className="h-4 w-4" /> : null}
      {children}
      {RightIcon ? <RightIcon className="h-4 w-4" /> : null}
    </button>
  );
};

export const IconButton = ({ label = 'Button', className = '', children, ...props }) => (
  <Button aria-label={label} title={label} variant="secondary" size="icon" className={className} {...props}>{children}</Button>
);

export const FieldLabel = ({ children, tone = 'default' }) => (
  <label className={cx('text-xs font-black uppercase tracking-[0.16em] block mb-2', tone === 'admin' ? 'text-amber-600' : 'text-slate-500')}>{children}</label>
);

export const FieldHelp = ({ children, tone = 'muted' }) => {
  if (!children) return null;
  const tones = {
    muted: 'text-slate-400',
    error: 'text-red-600',
    success: 'text-emerald-600',
    info: 'text-indigo-600',
  };
  return <p className={cx('mt-1.5 text-xs font-bold', tones[tone] || tones.muted)}>{children}</p>;
};

export const FormField = ({ label, help, error, children, tone = 'default', className = '' }) => (
  <div className={className}>
    {label && <FieldLabel tone={tone}>{label}</FieldLabel>}
    {children}
    <FieldHelp tone={error ? 'error' : 'muted'}>{error || help}</FieldHelp>
  </div>
);

export const controlClassName = 'w-full border-2 border-slate-100 rounded-2xl p-3.5 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none transition-colors font-bold text-slate-800 min-w-0';

export const TextInput = React.forwardRef(({ className = '', invalid = false, ...props }, ref) => (
  <input ref={ref} className={cx(controlClassName, invalid && 'border-red-200 bg-red-50 focus:border-red-400', className)} {...props} />
));
TextInput.displayName = 'TextInput';

export const SelectInput = React.forwardRef(({ className = '', invalid = false, children, ...props }, ref) => (
  <select ref={ref} className={cx(controlClassName, 'cursor-pointer', invalid && 'border-red-200 bg-red-50 focus:border-red-400', className)} {...props}>{children}</select>
));
SelectInput.displayName = 'SelectInput';

export const TextArea = React.forwardRef(({ className = '', invalid = false, ...props }, ref) => (
  <textarea ref={ref} className={cx(controlClassName, 'resize-none', invalid && 'border-red-200 bg-red-50 focus:border-red-400', className)} {...props} />
));
TextArea.displayName = 'TextArea';

export const ModalShell = ({
  isOpen,
  title,
  eyebrow,
  onClose,
  children,
  footer,
  size = 'xl',
  ariaLabel,
  className = '',
  cardClassName = '',
  lockScrollClass = 'kalpa-modal-open',
  zIndex = LAYER_Z.modal,
  initialFocusSelector,
}) => {
  const sizes = {
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    full: 'max-w-[calc(100vw-2rem)]',
  };
  return (
    <PortalLayer
      isOpen={isOpen}
      className={cx('kalpa-shared-modal-layer fixed inset-0 bg-slate-950/55 backdrop-blur-sm p-3 sm:p-6', className)}
      style={{ zIndex }}
      lockScrollClass={lockScrollClass}
      role="dialog"
      ariaModal={true}
      ariaLabel={ariaLabel || title || 'Dialog'}
      onEscape={onClose}
      initialFocusSelector={initialFocusSelector}
    >
      <div className={cx('kalpa-shared-modal-card mx-auto flex h-full w-full flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl ring-1 ring-slate-200/70', sizes[size] || sizes.xl, cardClassName)}>
        {(title || eyebrow || onClose) && (
          <div className="kalpa-shared-modal-header flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
            <div className="min-w-0">
              {eyebrow && <p className="mb-1 text-xs font-black uppercase tracking-[0.22em] text-indigo-500">{eyebrow}</p>}
              {title && <h2 className="truncate text-2xl sm:text-3xl font-black tracking-tight text-slate-900">{title}</h2>}
            </div>
            {onClose && (
              <IconButton label="Close dialog" onClick={onClose} className="shrink-0">
                <X className="h-5 w-5" />
              </IconButton>
            )}
          </div>
        )}
        <div className="kalpa-shared-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          {children}
        </div>
        {footer && <div className="kalpa-shared-modal-footer shrink-0 border-t border-slate-100 bg-white/95 px-5 py-4 sm:px-7">{footer}</div>}
      </div>
    </PortalLayer>
  );
};

export const InlineAlert = ({ children, tone = 'error', className = '' }) => {
  const tones = {
    error: 'border-red-100 bg-red-50 text-red-700',
    warning: 'border-amber-100 bg-amber-50 text-amber-700',
    info: 'border-indigo-100 bg-indigo-50 text-indigo-700',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  };
  return <div className={cx('rounded-2xl border-2 px-4 py-3 text-sm font-bold', tones[tone] || tones.error, className)} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
};


export const LoadingSpinner = ({ label = 'Loading', size = 'md', className = '' }) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-9 w-9' };
  return (
    <span className={cx('inline-flex items-center justify-center gap-2 font-black text-slate-500', className)} role="status" aria-live="polite">
      <Loader2 className={cx('animate-spin text-indigo-600', sizes[size] || sizes.md)} />
      {label ? <span className="text-xs uppercase tracking-widest">{label}</span> : null}
    </span>
  );
};

export const LoadingState = ({ title = 'Loading', subtitle = 'Please wait while the latest data is prepared.', compact = false, className = '' }) => (
  <div className={cx('kalpa-loading-state rounded-3xl border-2 border-slate-100 bg-white/90 text-center shadow-sm', compact ? 'p-5' : 'p-8', className)} role="status" aria-live="polite">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50">
      <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
    </div>
    <p className="text-sm font-black text-slate-800">{title}</p>
    {subtitle ? <p className="mx-auto mt-1 max-w-md text-xs font-bold text-slate-400">{subtitle}</p> : null}
  </div>
);

export const SkeletonBlock = ({ className = '', lines = 1 }) => (
  <div className={cx('kalpa-skeleton space-y-2', className)} aria-hidden="true">
    {Array.from({ length: Math.max(1, lines) }).map((_, index) => (
      <div key={index} className={cx('h-3 animate-pulse rounded-full bg-slate-100', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
    ))}
  </div>
);

export const EmptyStatePanel = ({ icon: Icon = Inbox, title = 'Nothing to show yet', description = 'New activity will appear here automatically.', action = null, compact = false, className = '' }) => (
  <div className={cx('kalpa-empty-state w-full rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/80 text-center', compact ? 'p-5' : 'p-8', className)}>
    <div className={cx('mx-auto mb-3 flex items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-sm', compact ? 'h-11 w-11' : 'h-14 w-14')}>
      <Icon className={cx('text-slate-400', compact ? 'h-5 w-5' : 'h-6 w-6')} />
    </div>
    <p className="text-sm font-black text-slate-700">{title}</p>
    {description ? <p className="mx-auto mt-1 max-w-md text-xs font-bold text-slate-400">{description}</p> : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);

export const RetryState = ({ title = 'Could not load this section', description = 'Please try again. Other parts of the app can continue working.', onRetry, className = '' }) => (
  <div className={cx('kalpa-retry-state rounded-3xl border-2 border-amber-100 bg-amber-50/70 p-6 text-center', className)} role="alert">
    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-100 bg-white">
      <AlertTriangle className="h-6 w-6 text-amber-600" />
    </div>
    <p className="text-sm font-black text-slate-800">{title}</p>
    {description ? <p className="mx-auto mt-1 max-w-md text-xs font-bold text-amber-700/80">{description}</p> : null}
    {onRetry ? <Button type="button" variant="secondary" size="sm" leftIcon={RefreshCw} onClick={onRetry} className="mt-4">Retry</Button> : null}
  </div>
);

export const StatusAlert = ({ children, tone = 'info', title, className = '' }) => {
  const tones = {
    success: { box: 'border-emerald-100 bg-emerald-50 text-emerald-800', icon: CheckCircle, iconClass: 'text-emerald-600' },
    error: { box: 'border-red-100 bg-red-50 text-red-800', icon: AlertCircle, iconClass: 'text-red-600' },
    warning: { box: 'border-amber-100 bg-amber-50 text-amber-800', icon: AlertTriangle, iconClass: 'text-amber-600' },
    info: { box: 'border-indigo-100 bg-indigo-50 text-indigo-800', icon: Info, iconClass: 'text-indigo-600' },
  };
  const cfg = tones[tone] || tones.info;
  const Icon = cfg.icon;
  return (
    <div className={cx('kalpa-status-alert flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold', cfg.box, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', cfg.iconClass)} />
      <div className="min-w-0">
        {title ? <p className="font-black text-slate-900">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5' : ''}>{children}</div> : null}
      </div>
    </div>
  );
};

const toastIconFor = (toast = {}) => {
  const category = String(toast.category || '').toLowerCase();
  const type = String(toast.type || '').toLowerCase();
  const priority = String(toast.priority || '').toLowerCase();
  if (priority === 'critical' || type === 'urgent' || type === 'error') return { icon: AlertCircle, className: 'text-red-500', bg: 'bg-red-50 border-red-100' };
  if (type === 'success') return { icon: CheckCircle, className: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' };
  if (category === 'chat' || type === 'chat' || type === 'mention') return { icon: MessageSquare, className: 'text-purple-600', bg: 'bg-purple-50 border-purple-100' };
  return { icon: Bell, className: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' };
};

export const ToastViewport = ({ toasts = [], onDismiss, max = 3, className = '' }) => {
  const visible = Array.isArray(toasts) ? toasts.slice(0, max) : [];
  if (!visible.length) return null;
  return (
    <PortalLayer
      isOpen={visible.length > 0}
      className={cx('kalpa-toast-layer pointer-events-none fixed right-3 top-20 max-w-[calc(100vw-1.5rem)] space-y-3 sm:right-4 sm:top-24', className)}
      style={{ zIndex: LAYER_Z.notification }}
      lockScroll={false}
      lockScrollClass=""
      ariaLabel="Notifications"
    >
      <div aria-live="polite" aria-relevant="additions" className="space-y-3">
        {visible.map((toast, index) => {
          const cfg = toastIconFor(toast);
          const Icon = cfg.icon;
          return (
            <div
              key={toast.id || index}
              className="kalpa-toast-card pointer-events-auto w-[340px] max-w-full rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-2xl backdrop-blur animate-in slide-in-from-right-4 fade-in duration-200"
              style={{ transform: `translateY(${index * 2}px)` }}
            >
              <div className="flex items-start gap-3">
                <div className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', cfg.bg)}><Icon className={cx('h-5 w-5', cfg.className)} /></div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">{toast.category || 'Notification'}</span>
                    {toast.priority ? <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{toast.priority}</span> : null}
                  </div>
                  {toast.title ? <div className="break-words font-black leading-snug">{toast.title}</div> : null}
                  {toast.message || toast.text ? <div className="mt-1 break-words text-xs font-semibold text-slate-500">{toast.message || toast.text}</div> : null}
                  {toast.time ? <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{toast.time}</div> : null}
                </div>
                {onDismiss ? (
                  <button type="button" onClick={() => onDismiss(toast.id)} className="rounded-lg p-1 text-slate-300 hover:bg-slate-50 hover:text-slate-600" aria-label="Dismiss notification"><X className="h-4 w-4" /></button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </PortalLayer>
  );
};
