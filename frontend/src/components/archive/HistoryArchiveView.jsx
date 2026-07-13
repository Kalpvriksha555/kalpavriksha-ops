import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Calendar, Check, Filter } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { formatTaskId, getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';
import { PAYMENT_TRACKING_OPTIONS, getPaymentTrackingStatus, getPaymentStatusBadgeClass } from '../../utils/paymentStatusUtils';
import { MultiSelectCheckbox } from '../shared';

const getCustomerDisplayName = (project = {}) => project.customerName || 'Customer not added';
const isAdminUser = (user = {}) => String(user?.role || '').trim().toUpperCase() === 'ADMIN';
const isRevisionWorkItem = (project = {}) => project.isRevisionWorkItem === true || String(project.id || '').includes('__REV__');
const getArchiveBank = (project = {}) => String(project.client || project.bankName || project.bank || 'Bank not added').trim();
const getArchiveLocation = (project = {}) => String(project.location || project.city || 'Location not added').trim();

const getArchiveRevisionSummary = (project = {}) => {
  const history = Array.isArray(project.revisionHistory) ? project.revisionHistory : [];
  const reviewHistory = Array.isArray(project.reviewHistory) ? project.reviewHistory.filter(item => String(item.action || item.comment || '').toLowerCase().includes('revision')) : [];
  const active = Array.isArray(project.subTasks) ? project.subTasks.filter(item => !['done', 'completed', 'approved', 'closed'].includes(String(item.status || '').toLowerCase())) : [];
  const total = Math.max(history.length, reviewHistory.length, active.length ? history.length + active.length : history.length);
  const completed = history.filter(item => ['done', 'completed', 'approved', 'closed'].includes(String(item.status || item.action || '').toLowerCase())).length;
  return { total, completed, active: active.length };
};

const getCompletedDateKey = (completedAt) => {
  const d = new Date(completedAt);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const ArchiveFilters = ({
  filterMonth,
  filterDate,
  months,
  banks,
  locations,
  selectedBanks,
  selectedLocations,
  onMonthChange,
  onDateChange,
  onBanksChange,
  onLocationsChange,
  onClear,
}) => (
  <div className="flex flex-wrap items-end gap-3 bg-white p-3 rounded-2xl border-2 border-slate-100 shadow-sm w-full">
    <div className="flex flex-col min-w-[170px]">
      <label className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Completed month</label>
      <div className="flex items-center space-x-2 px-3 min-h-11 border-2 border-slate-200 rounded-xl">
        <Calendar className="w-5 h-5 text-indigo-400" />
        <select value={filterMonth} onChange={(event) => onMonthChange(event.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full">
          <option value="All">All Months</option>
          {months.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
      </div>
    </div>
    <div className="flex flex-col min-w-[170px]">
      <label className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">Exact date</label>
      <div className="flex items-center space-x-2 px-3 min-h-11 border-2 border-slate-200 rounded-xl">
        <Filter className="w-5 h-5 text-indigo-400" />
        <input type="date" value={filterDate} onChange={(event) => onDateChange(event.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full" />
      </div>
    </div>
    <MultiSelectCheckbox label="Banks" options={banks} selectedValues={selectedBanks} onChange={onBanksChange} allLabel="All Banks" />
    <MultiSelectCheckbox label="Locations" options={locations} selectedValues={selectedLocations} onChange={onLocationsChange} allLabel="All Locations" />
    {(filterDate || filterMonth !== 'All' || selectedBanks.length > 0 || selectedLocations.length > 0) && (
      <button type="button" onClick={onClear} className="min-h-11 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl transition-colors">Clear all</button>
    )}
  </div>
);
const ArchivePaymentControl = ({ project, currentUser, onPaymentStatusChange }) => {
  if (!isAdminUser(currentUser)) return null;
  const status = getPaymentTrackingStatus(project);
  const handleChange = (event) => {
    event.stopPropagation();
    if (typeof onPaymentStatusChange === 'function') onPaymentStatusChange(project, event.target.value);
  };
  return (
    <label className={`kalpa-payment-control ${getPaymentStatusBadgeClass(status)}`} title={`Payment status: ${status}`} onClick={(event) => event.stopPropagation()}>
      <span className="kalpa-payment-dot" aria-hidden="true" />
      <select
        value={status}
        onClick={(event) => event.stopPropagation()}
        onChange={handleChange}
        className="kalpa-payment-select"
        aria-label={`Payment status for ${project.id}`}
      >
        {PAYMENT_TRACKING_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
};

const ArchiveTaskMeta = ({ project, currentUser }) => {
  const description = getTaskDescription(project);
  const estimateDetails = getEstimateDetails(project);
  const completedFileName = getLatestCompletedFileName(project);

  return (
    <div className="space-y-1.5">
      <p className="font-bold text-slate-800 text-base">{formatTaskId(project.id)}</p>
      <p className="text-xs font-medium text-slate-500">{getCustomerDisplayName(project)} • {project.type}</p>
      {description && (
        <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">
          {description}
        </p>
      )}
      {estimateDetails && (
        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">
          ₹ {estimateDetails}
        </p>
      )}
      {completedFileName && (
        <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 w-fit max-w-lg truncate">
          📄 {completedFileName}
        </p>
      )}
      {(() => {
        const revisionSummary = getArchiveRevisionSummary(project);
        if (!revisionSummary.total && !revisionSummary.active) return null;
        return (
          <p className="text-[11px] font-black text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-2 py-1 w-fit max-w-lg truncate">
            ↻ Revisions: {revisionSummary.total} total • {revisionSummary.completed} completed{revisionSummary.active ? ` • ${revisionSummary.active} active` : ''}
          </p>
        );
      })()}
    </div>
  );
};

const ArchiveTableRow = ({ project, onSelectProject, currentUser, onPaymentStatusChange }) => (
  <tr data-task-id={String(project.id || project.caseId || '')} className="hover:bg-slate-50 cursor-pointer transition-colors group" onClick={() => onSelectProject(project)}>
    <td className="px-4 py-5">
      <span className="font-bold text-slate-700">{project.completedAt ? formatDateTime(project.completedAt) : '-'}</span>
      <p className="text-[11px] font-semibold text-slate-400 mt-1">{project.completedAt ? new Date(project.completedAt).toLocaleTimeString() : ''}</p>
    </td>
    <td className="px-4 py-5 min-w-0">
      <ArchiveTaskMeta project={project} currentUser={currentUser} />
    </td>
    <td className="px-4 py-5 font-medium text-slate-600 truncate">{project.location}</td>
    <td className="px-4 py-5 font-medium text-slate-600 truncate">{project.assignedTo}</td>
    {isAdminUser(currentUser) && (
      <td className="px-4 py-5">
        <ArchivePaymentControl project={project} currentUser={currentUser} onPaymentStatusChange={onPaymentStatusChange} />
      </td>
    )}
    <td className="px-6 py-5 text-right">
      <div className="flex items-center justify-end gap-2">
        {project.reportSent && (
          <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center mr-2">
            <Check className="w-3 h-3 mr-1" /> Sent
          </span>
        )}
        <button type="button" className="text-indigo-600 bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-sm whitespace-nowrap">
          View
        </button>
      </div>
    </td>
  </tr>
);

export const HistoryArchiveView = ({ projects, onSelectProject, currentUser, archiveViewState, setArchiveViewState, onPaymentStatusChange }) => {
  const [localArchiveViewState, setLocalArchiveViewState] = useState({ filterMonth: 'All', filterDate: '', selectedBanks: [], selectedLocations: [] });
  const effectiveArchiveViewState = archiveViewState || localArchiveViewState;
  const filterMonth = effectiveArchiveViewState?.filterMonth || 'All';
  const filterDate = effectiveArchiveViewState?.filterDate || '';
  const selectedBanks = Array.isArray(effectiveArchiveViewState?.selectedBanks) ? effectiveArchiveViewState.selectedBanks : [];
  const selectedLocations = Array.isArray(effectiveArchiveViewState?.selectedLocations) ? effectiveArchiveViewState.selectedLocations : [];
  const bankFilterKey = selectedBanks.join('|');
  const locationFilterKey = selectedLocations.join('|');
  const updateArchiveViewState = (patch) => {
    const updater = (prev = {}) => ({ filterMonth: 'All', filterDate: '', selectedBanks: [], selectedLocations: [], searchText: '', sortOrder: 'newest', scrollTop: 0, ...prev, ...patch });
    if (typeof setArchiveViewState === 'function') setArchiveViewState(updater);
    else setLocalArchiveViewState(updater);
  };
  const archiveTableRef = useRef(null);
  useEffect(() => {
    const node = archiveTableRef.current;
    if (!node) return;
    const savedScrollTop = Number(effectiveArchiveViewState?.scrollTop || 0);
    if (savedScrollTop > 0) requestAnimationFrame(() => { node.scrollTop = savedScrollTop; });
  }, [filterMonth, filterDate, bankFilterKey, locationFilterKey]);
  const rememberArchiveScroll = () => {
    const node = archiveTableRef.current;
    if (node) updateArchiveViewState({ scrollTop: node.scrollTop });
  };
  const handleArchivePaymentStatusChange = async (project, status) => {
    const node = archiveTableRef.current;
    const taskId = String(project.id || project.caseId || '');
    const row = node ? Array.from(node.querySelectorAll('[data-task-id]')).find((item) => item.dataset.taskId === taskId) : null;
    const savedScrollTop = Number(node?.scrollTop || 0);
    const rowViewportOffset = row && node ? row.offsetTop - node.scrollTop : null;
    updateArchiveViewState({ scrollTop: savedScrollTop, lastPaymentTaskId: taskId });
    if (typeof onPaymentStatusChange === 'function') await onPaymentStatusChange(project, status);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const currentNode = archiveTableRef.current;
      if (!currentNode) return;
      const currentRow = Array.from(currentNode.querySelectorAll('[data-task-id]')).find((item) => item.dataset.taskId === taskId);
      currentNode.scrollTop = currentRow && rowViewportOffset !== null ? Math.max(0, currentRow.offsetTop - rowViewportOffset) : savedScrollTop;
      updateArchiveViewState({ scrollTop: currentNode.scrollTop, lastPaymentTaskId: taskId });
    }));
  };

  const archived = useMemo(() => (projects || [])
    .filter((project) => project.status === 'Completed' && !isRevisionWorkItem(project))
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)), [projects]);

  const uniqueMonths = useMemo(() => [...new Set(archived.map((project) => {
    if (!project.completedAt) return null;
    try {
      return new Date(project.completedAt).toLocaleString('default', { month: 'long', year: 'numeric' });
    } catch (error) {
      return null;
    }
  }).filter(Boolean))], [archived]);
  const uniqueBanks = useMemo(() => [...new Set(archived.map(getArchiveBank).filter(Boolean))].sort(), [archived]);
  const uniqueLocations = useMemo(() => [...new Set(archived.map(getArchiveLocation).filter(Boolean))].sort(), [archived]);

  const filteredArchived = useMemo(() => archived.filter((project) => {
    if (!project.completedAt) return false;
    try {
      const completedDate = new Date(project.completedAt);
      const monthYear = completedDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      const exactDate = getCompletedDateKey(project.completedAt);
      if (filterDate && exactDate !== filterDate) return false;
      if (filterMonth !== 'All' && monthYear !== filterMonth) return false;
      if (selectedBanks.length > 0 && !selectedBanks.includes(getArchiveBank(project))) return false;
      if (selectedLocations.length > 0 && !selectedLocations.includes(getArchiveLocation(project))) return false;
      return true;
    } catch (error) {
      return false;
    }
  }), [archived, filterDate, filterMonth, bankFilterKey, locationFilterKey]);

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-5">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-800 flex items-center tracking-tight">
            <Archive className="w-8 h-8 mr-3 text-indigo-500" /> Task History Catalog
          </h2>
          <p className="text-slate-500 mt-2 font-medium">{filteredArchived.length} Completed Tasks securely stored on the cloud.</p>
        </div>
        <ArchiveFilters
          filterMonth={filterMonth}
          filterDate={filterDate}
          months={uniqueMonths}
          banks={uniqueBanks}
          locations={uniqueLocations}
          selectedBanks={selectedBanks}
          selectedLocations={selectedLocations}
          onMonthChange={(month) => updateArchiveViewState({ filterMonth: month, filterDate: '', scrollTop: 0 })}
          onDateChange={(date) => updateArchiveViewState({ filterDate: date, filterMonth: 'All', scrollTop: 0 })}
          onBanksChange={(values) => updateArchiveViewState({ selectedBanks: values, scrollTop: 0 })}
          onLocationsChange={(values) => updateArchiveViewState({ selectedLocations: values, scrollTop: 0 })}
          onClear={() => updateArchiveViewState({ filterMonth: 'All', filterDate: '', selectedBanks: [], selectedLocations: [], scrollTop: 0 })}
        />
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div ref={archiveTableRef} onScroll={rememberArchiveScroll} className="kalpa-archive-table-wrap">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Date Completed</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task Details</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Location</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Designer</th>
                {isAdminUser(currentUser) && <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Payment</th>}
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredArchived.map((project) => (
                <ArchiveTableRow key={project.id} project={project} onSelectProject={(p) => { rememberArchiveScroll(); onSelectProject(p); }} currentUser={currentUser} onPaymentStatusChange={handleArchivePaymentStatusChange} />
              ))}
              {filteredArchived.length === 0 && (
                <tr><td colSpan={isAdminUser(currentUser) ? 6 : 5} className="px-6 py-16 text-center text-slate-400 font-medium">No completed tasks found for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
