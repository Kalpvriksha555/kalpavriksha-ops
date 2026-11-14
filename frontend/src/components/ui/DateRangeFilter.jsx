import React from 'react';
import { validDateRange } from '../../utils/dateRangeFilters.js';

// In-memory selection only. Owning pages reset on a new browser visit.
export const DateRangeFilter = ({ from='', to='', onChange, className='', label='Activity date range' }) => {
  const invalid = !validDateRange(from,to);
  return (
    <div className={className} role="group" aria-label={label}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">From date</span>
          <input type="date" value={from} onChange={event=>onChange({dateFrom:event.target.value})}
            aria-label={label+' from'} aria-invalid={invalid}
            className="min-h-10 px-3 bg-white border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-700" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">To date</span>
          <input type="date" value={to} onChange={event=>onChange({dateTo:event.target.value})}
            aria-label={label+' to'} aria-invalid={invalid}
            className="min-h-10 px-3 bg-white border-2 border-slate-200 rounded-xl text-sm font-bold text-slate-700" />
        </label>
      </div>
      {invalid && <p role="alert" className="text-xs font-bold text-red-600 mt-1">From date must be on or before To date.</p>}
    </div>
  );
};
