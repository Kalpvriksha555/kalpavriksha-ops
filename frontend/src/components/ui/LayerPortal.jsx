import React, { useEffect, useRef } from 'react';
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

const scrollLockState = {
  count: 0,
  overflow: '',
  overscrollBehavior: '',
  classes: new Map(),
};

const addBodyClass = (className) => {
  if (!className || !hasDocument()) return;
  const current = scrollLockState.classes.get(className) || 0;
  scrollLockState.classes.set(className, current + 1);
  document.body.classList.add(className);
};

const removeBodyClass = (className) => {
  if (!className || !hasDocument()) return;
  const current = scrollLockState.classes.get(className) || 0;
  if (current <= 1) {
    scrollLockState.classes.delete(className);
    document.body.classList.remove(className);
  } else {
    scrollLockState.classes.set(className, current - 1);
  }
};

export const useBodyScrollLock = (enabled, extraClass = '') => {
  useEffect(() => {
    if (!enabled || !hasDocument()) return undefined;
    const body = document.body;
    if (scrollLockState.count === 0) {
      scrollLockState.overflow = body.style.overflow;
      scrollLockState.overscrollBehavior = body.style.overscrollBehavior;
      body.style.overflow = 'hidden';
      body.style.overscrollBehavior = 'none';
    }
    scrollLockState.count += 1;
    addBodyClass('kalpa-overlay-open');
    addBodyClass(extraClass);
    return () => {
      scrollLockState.count = Math.max(0, scrollLockState.count - 1);
      removeBodyClass(extraClass);
      removeBodyClass('kalpa-overlay-open');
      if (scrollLockState.count === 0 && hasDocument()) {
        body.style.overflow = scrollLockState.overflow;
        body.style.overscrollBehavior = scrollLockState.overscrollBehavior;
      }
    };
  }, [enabled, extraClass]);
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const getFocusable = (root) => Array.from(root?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])
  .filter((node) => node && !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null);

export const PortalLayer = ({
  isOpen,
  children,
  className = '',
  style,
  role,
  ariaModal,
  ariaLabel,
  lockScrollClass = '',
  lockScroll = true,
  onEscape,
  trapFocus,
  initialFocusSelector,
}) => {
  const layerRef = useRef(null);
  const shouldTrapFocus = trapFocus ?? (role === 'dialog' || ariaModal === true);
  useBodyScrollLock(Boolean(isOpen && lockScroll), lockScrollClass);

  useEffect(() => {
    if (!isOpen || !shouldTrapFocus || !hasDocument()) return undefined;
    const previousActiveElement = document.activeElement;
    const focusInitial = () => {
      const root = layerRef.current;
      if (!root) return;
      const requested = initialFocusSelector ? root.querySelector(initialFocusSelector) : null;
      const firstFocusable = requested || getFocusable(root)[0] || root;
      if (typeof firstFocusable.focus === 'function') firstFocusable.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(focusInitial, 0);
    return () => {
      window.clearTimeout(timer);
      if (previousActiveElement && typeof previousActiveElement.focus === 'function' && hasDocument() && document.body.contains(previousActiveElement)) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [isOpen, shouldTrapFocus, initialFocusSelector]);

  useEffect(() => {
    if (!isOpen || !hasDocument()) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && typeof onEscape === 'function') {
        event.preventDefault();
        event.stopPropagation();
        onEscape(event);
        return;
      }
      if (!shouldTrapFocus || event.key !== 'Tab') return;
      const root = layerRef.current;
      const focusable = getFocusable(root);
      if (!root || focusable.length === 0) {
        event.preventDefault();
        root?.focus?.({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onEscape, shouldTrapFocus]);

  if (!isOpen || !hasDocument()) return null;
  return createPortal(
    <div
      ref={layerRef}
      className={`kalpa-layer-root ${className}`.trim()}
      style={style}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      tabIndex={shouldTrapFocus ? -1 : undefined}
    >
      {children}
    </div>,
    document.body
  );
};
