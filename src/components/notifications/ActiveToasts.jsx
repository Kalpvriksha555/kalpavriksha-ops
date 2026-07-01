import React from "react";

export const ActiveToasts = ({ toasts = [], notifications = [] }) => {
  const source = Array.isArray(toasts) && toasts.length ? toasts : [];
  if (!source.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] space-y-3 pointer-events-none">
      {source.slice(0, 4).map((toast, index) => (
        <div
          key={toast.id || index}
          className="pointer-events-auto bg-white border border-slate-200 shadow-xl rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 min-w-[260px]"
        >
          {toast.title && <div className="font-black mb-1">{toast.title}</div>}
          <div>{toast.message || toast.text || "Notification"}</div>
        </div>
      ))}
    </div>
  );
};
