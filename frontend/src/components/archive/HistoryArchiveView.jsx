import { asArray } from '../../utils/runtimeShapeUtils.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Calendar, Check, ChevronDown, ChevronRight, Filter, MapPin, Search } from 'lucide-react';
import { formatDateTime, formatMonthLabel } from '../../utils/date';
import { formatTaskId, getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';
import { PAYMENT_TRACKING_OPTIONS, getPaymentTrackingStatus, getPaymentStatusBadgeClass } from '../../utils/paymentStatusUtils';
import { getArchiveBank, getArchiveLocation, getCompletedDateKey, groupArchivedByLocation, matchesArchiveSearch } from '../../utils/archiveUtils.js';
import { MultiSelectCheckbox } from '../shared';

const getCustomerDisplayName = (project = {}) => project?.customerName || 'Customer not added';
const isAdminUser = (user = {}) => String(user?.role || '').trim().toUpperCase() === 'ADMIN';
const isRevisionWorkItem = (project = {}) => project?.isRevisionWorkItem === true || String(project?.id || '').includes('__REV__');
const getArchiveSearchExtras = (project = {}) => [getTaskDescription(project), getEstimateDetails(project), getLatestCompletedFileName(project), getPaymentTrackingStatus(project)];

const ArchivePaymentControl = ({ project, currentUser, onPaymentStatusChange }) => {
  if (!isAdminUser(currentUser)) return null;
  const status = getPaymentTrackingStatus(project);
  return (
    <label className={`kalpa-payment-control ${getPaymentStatusBadgeClass(status)}`} title={`Payment status: ${status}`} onClick={(event) => event.stopPropagation()}>
      <span className="kalpa-payment-dot" aria-hidden="true" />
      <select value={status} onChange={(event) => onPaymentStatusChange?.(project, event.target.value)} className="kalpa-payment-select" aria-label={`Payment status for ${project.id}`}>
        {PAYMENT_TRACKING_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
};

const ArchiveTaskMeta = ({ project }) => {
  const description = getTaskDescription(project);
  const estimateDetails = getEstimateDetails(project);
  const completedFileName = getLatestCompletedFileName(project);
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="font-bold text-slate-800 text-base">{formatTaskId(project.id)}</p>
      <p className="text-xs font-medium text-slate-500">{getCustomerDisplayName(project)} • {project.type || 'Task'}</p>
      {description && <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">{description}</p>}
      {estimateDetails && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">₹ {estimateDetails}</p>}
      {completedFileName && <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 w-fit max-w-full truncate">📄 {completedFileName}</p>}
    </div>
  );
};

const ArchiveRow = ({ project, currentUser, onSelectProject, onPaymentStatusChange }) => (
  <tr className="hover:bg-slate-50 cursor-pointer transition-colors group" onClick={() => onSelectProject(project)}>
    <td className="px-4 py-4"><span className="font-bold text-slate-700">{project.completedAt ? formatDateTime(project.completedAt) : '-'}</span></td>
    <td className="px-4 py-4 min-w-0"><ArchiveTaskMeta project={project} /></td>
    <td className="px-4 py-4 font-medium text-slate-600 truncate">{project.assignedTo || 'Unassigned'}</td>
    {isAdminUser(currentUser) && <td className="px-4 py-4"><ArchivePaymentControl project={project} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} /></td>}
    <td className="px-4 py-4 text-right"><button type="button" className="text-indigo-600 bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white px-3 py-2 rounded-xl text-xs font-bold">View</button></td>
  </tr>
);

const ArchiveMobileCard = ({ project, currentUser, onSelectProject, onPaymentStatusChange }) => (
  <article className="kalpa-archive-mobile-card border-t border-slate-100 p-4 first:border-t-0">
    <button type="button" onClick={() => onSelectProject(project)} className="w-full text-left space-y-3">
      <ArchiveTaskMeta project={project} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
        <span>{project.completedAt ? formatDateTime(project.completedAt) : '-'}</span>
        <span>{project.assignedTo || 'Unassigned'}</span>
      </div>
    </button>
    {isAdminUser(currentUser) && <div className="mt-3"><ArchivePaymentControl project={project} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} /></div>}
  </article>
);

const ArchiveFilters = ({ state, months, banks, locations, onChange, onClear }) => (
  <div className="flex flex-wrap items-end gap-3 bg-white p-3 rounded-2xl border-2 border-slate-100 shadow-sm w-full">
    <label className="flex flex-col flex-1 min-w-[220px]">
      <span className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Search archive</span>
      <span className="flex items-center gap-2 px-3 min-h-11 border-2 border-slate-200 rounded-xl"><Search className="w-4 h-4 text-indigo-400" /><input value={state.searchText} onChange={(event) => onChange({ searchText: event.target.value, scrollTop: 0 })} placeholder="Task, customer, bank, designer…" className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full" /></span>
    </label>
    <label className="flex flex-col min-w-[165px]"><span className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Completed month</span><span className="flex items-center gap-2 px-3 min-h-11 border-2 border-slate-200 rounded-xl"><Calendar className="w-4 h-4 text-indigo-400" /><select value={state.filterMonth} onChange={(event) => onChange({ filterMonth: event.target.value, filterDate: '', scrollTop: 0 })} className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full"><option value="All">All Months</option>{months.map((month) => <option key={month}>{month}</option>)}</select></span></label>
    <label className="flex flex-col min-w-[165px]"><span className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Exact date</span><span className="flex items-center gap-2 px-3 min-h-11 border-2 border-slate-200 rounded-xl"><Filter className="w-4 h-4 text-indigo-400" /><input type="date" value={state.filterDate} onChange={(event) => onChange({ filterDate: event.target.value, filterMonth: 'All', scrollTop: 0 })} className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full" /></span></label>
    <MultiSelectCheckbox label="Banks" options={banks} selectedValues={state.selectedBanks} onChange={(values) => onChange({ selectedBanks: values, scrollTop: 0 })} allLabel="All Banks" />
    <MultiSelectCheckbox label="Locations" options={locations} selectedValues={state.selectedLocations} onChange={(values) => onChange({ selectedLocations: values, scrollTop: 0 })} allLabel="All Locations" />
    <button type="button" onClick={onClear} className="min-h-11 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl">Clear all</button>
  </div>
);

export const HistoryArchiveView = ({ projects, onSelectProject, currentUser, archiveViewState, setArchiveViewState, onPaymentStatusChange }) => {
  const [localState, setLocalState] = useState({});
  const rawState = archiveViewState && typeof archiveViewState === 'object' ? archiveViewState : localState;
  const state = {
    filterMonth: String(rawState?.filterMonth || 'All'),
    filterDate: String(rawState?.filterDate || ''),
    selectedBanks: Array.isArray(rawState?.selectedBanks) ? rawState.selectedBanks : [],
    selectedLocations: Array.isArray(rawState?.selectedLocations) ? rawState.selectedLocations : [],
    searchText: String(rawState?.searchText || ''),
    openLocations: Array.isArray(rawState?.openLocations) ? rawState.openLocations : [],
    scrollTop: Number(rawState?.scrollTop || 0) || 0
  };
  const viewportRef = useRef(null);
  const update = (patch) => {
    const updater = (previous = {}) => ({ filterMonth: 'All', filterDate: '', selectedBanks: [], selectedLocations: [], searchText: '', openLocations: [], scrollTop: 0, ...previous, ...patch });
    if (setArchiveViewState) setArchiveViewState(updater); else setLocalState(updater);
  };

  const archived = useMemo(() => asArray(projects).filter((project) => project.status === 'Completed' && !isRevisionWorkItem(project)).sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0)), [projects]);
  const months = useMemo(() => [...new Set(archived.map((project) => project.completedAt ? formatMonthLabel(project.completedAt) : null).filter(Boolean))], [archived]);
  const banks = useMemo(() => [...new Set(archived.map(getArchiveBank))].sort(), [archived]);
  const locations = useMemo(() => [...new Set(archived.map(getArchiveLocation))].sort(), [archived]);
  const filtered = useMemo(() => archived.filter((project) => {
    if (!project.completedAt || !matchesArchiveSearch(project, state.searchText, getArchiveSearchExtras(project))) return false;
    if (state.filterDate && getCompletedDateKey(project.completedAt) !== state.filterDate) return false;
    if (state.filterMonth !== 'All' && formatMonthLabel(project.completedAt) !== state.filterMonth) return false;
    if (state.selectedBanks.length && !state.selectedBanks.includes(getArchiveBank(project))) return false;
    if (state.selectedLocations.length && !state.selectedLocations.includes(getArchiveLocation(project))) return false;
    return true;
  }), [archived, state.filterDate, state.filterMonth, state.searchText, state.selectedBanks.join('|'), state.selectedLocations.join('|')]);

  const groups = useMemo(() => groupArchivedByLocation(filtered), [filtered]);

  useEffect(() => {
    if (!groups.length || state.openLocations.length) return;
    update({ openLocations: [groups[0].location] });
  }, [groups.map((group) => group.location).join('|')]);
  useEffect(() => {
    if (viewportRef.current && state.scrollTop > 0) requestAnimationFrame(() => { viewportRef.current.scrollTop = state.scrollTop; });
  }, []);

  const openSet = new Set(state.openLocations);
  const toggleLocation = (location) => update({ openLocations: openSet.has(location) ? state.openLocations.filter((item) => item !== location) : [...state.openLocations, location] });
  const select = (project) => { update({ scrollTop: viewportRef.current?.scrollTop || 0 }); onSelectProject(project); };

  return (
    <section className="kalpa-production-polish space-y-5 animate-in fade-in duration-200" aria-labelledby="archive-title">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div><h2 id="archive-title" className="text-3xl font-extrabold text-slate-800 flex items-center tracking-tight"><Archive className="w-8 h-8 mr-3 text-indigo-500" /> Task History Catalog</h2><p className="text-slate-500 mt-2 font-medium">{filtered.length} completed tasks across {groups.length} location groups.</p></div>
          <div className="flex gap-2"><button type="button" onClick={() => update({ openLocations: groups.map((group) => group.location) })} className="px-3 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-black">Expand all</button><button type="button" onClick={() => update({ openLocations: [] })} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black">Collapse all</button></div>
        </div>
        <ArchiveFilters state={state} months={months} banks={banks} locations={locations} onChange={update} onClear={() => update({ filterMonth: 'All', filterDate: '', selectedBanks: [], selectedLocations: [], searchText: '', scrollTop: 0 })} />
      </div>

      <div ref={viewportRef} onScroll={(event) => update({ scrollTop: event.currentTarget.scrollTop })} className="kalpa-archive-groups max-h-[72vh] overflow-y-auto overscroll-contain pr-1" aria-live="polite">
        {groups.map((group) => {
          const isOpen = openSet.has(group.location);
          return (
            <section key={group.location} className="kalpa-archive-group">
              <button type="button" className="kalpa-archive-group-header" onClick={() => toggleLocation(group.location)} aria-expanded={isOpen} aria-controls={`archive-${group.location.replace(/\W+/g, '-')}`}>
                <span className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><MapPin className="h-5 w-5" /></span><span className="min-w-0"><strong className="block truncate text-base text-slate-800">{group.location}</strong><span className="kalpa-archive-group-summary"><span>{group.items.length} tasks</span>{isAdminUser(currentUser) && <span>{group.unpaid} unpaid/partial</span>}{isAdminUser(currentUser) && group.received > 0 && <span>₹{group.received.toLocaleString('en-IN')} received</span>}</span></span></span>
                {isOpen ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
              </button>
              {isOpen && <div id={`archive-${group.location.replace(/\W+/g, '-')}`}>
                <div className="kalpa-archive-desktop-table overflow-x-auto"><table className="w-full text-left text-sm whitespace-nowrap"><thead className="bg-slate-50 text-slate-500 border-y border-slate-100"><tr><th className="px-4 py-3 text-xs uppercase">Completed</th><th className="px-4 py-3 text-xs uppercase">Task details</th><th className="px-4 py-3 text-xs uppercase">Designer</th>{isAdminUser(currentUser) && <th className="px-4 py-3 text-xs uppercase">Payment</th>}<th className="px-4 py-3 text-xs uppercase text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{group.items.map((project) => <ArchiveRow key={project.id} project={project} currentUser={currentUser} onSelectProject={select} onPaymentStatusChange={onPaymentStatusChange} />)}</tbody></table></div>
                {group.items.map((project) => <ArchiveMobileCard key={`mobile-${project.id}`} project={project} currentUser={currentUser} onSelectProject={select} onPaymentStatusChange={onPaymentStatusChange} />)}
              </div>}
            </section>
          );
        })}
        {!groups.length && <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-16 text-center text-slate-400 font-bold">No completed tasks match these filters.</div>}
      </div>
    </section>
  );
};
