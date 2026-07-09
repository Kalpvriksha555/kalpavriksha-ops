import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export const LAYER_Z = Object.freeze({
  base: 0,
  stickyHeader: 40,
  notification: 2147482000,
  chat: 2147482500,
  modal: 2147483000,
  preview: 2147483100,
  critical: 2147483200,
});

const hasDocument = () => typeof document !== 'undefined' && document.body;

export const useBodyScrollLock = (enabled, extraClass = '') => {
  useEffect(() => {
    if (!enabled || !hasDocument()) return undefined;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousOverscroll = body.style.overscrollBehavior;
    body.classList.add('kalpa-overlay-open');
    if (extraClass) body.classList.add(extraClass);
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    return () => {
      body.classList.remove('kalpa-overlay-open');
      if (extraClass) body.classList.remove(extraClass);
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscroll;
    };
  }, [enabled, extraClass]);
};

export const PortalLayer = ({
  isOpen,
  children,
  className = '',
  style,
  role,
  ariaModal,
  ariaLabel,
  lockScrollClass = '',
}) => {
  useBodyScrollLock(Boolean(isOpen), lockScrollClass);
  if (!isOpen || !hasDocument()) return null;
  return createPortal(
    <div
      className={`kalpa-layer-root ${className}`.trim()}
      style={style}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body
  );
};
