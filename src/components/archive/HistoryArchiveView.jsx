import React, { useMemo, useState } from 'react';
import { Archive, Calendar, Check, Filter } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import { getEstimateDetails, getLatestCompletedFileName, getTaskDescription } from '../../utils/taskDisplayUtils';

const getCustomerDisplayName = (project = {}) => project.customerName || 'Customer not added';

const getCompletedDateKey = (completedAt) => {
  const d = new Date(completedAt);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const ArchiveFilters = ({ filterMonth, filterDate, months, onMonthChange, onDateChange, onClear }) => (
  <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl border-2 border-slate-100 shadow-sm w-full sm:w-auto">
    <div className="flex items-center space-x-2 px-3 py-1">
      <Calendar className="w-5 h-5 text-indigo-400" />
      <select
        value={filterMonth}
        onChange={(e) => onMonthChange(e.target.value)}
        className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
      >
        <option value="All">All Months</option>
        {months.map((month) => <option key={month} value={month}>{month}</option>)}
      </select>
    </div>
    <div className="w-0.5 h-8 bg-slate-100 hidden sm:block" />
    <div className="flex items-center space-x-2 px-3 py-1">
      <Filter className="w-5 h-5 text-indigo-400" />
      <input
        type="date"
        value={filterDate}
        onChange={(e) => onDateChange(e.target.value)}
        className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
      />
    </div>
    {(filterDate || filterMonth !== 'All') && (
      <button
        type="button"
        onClick={onClear}
        className="ml-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl transition-colors"
      >
        Clear
      </button>
    )}
  </div>
);

const ArchiveTaskMeta = ({ project }) => {
  const description = getTaskDescription(project);
  const estimateDetails = getEstimateDetails(project);
  const completedFileName = getLatestCompletedFileName(project);

  return (
    <div className="space-y-1.5">
      <p className="font-bold text-slate-800 text-base">{project.id}</p>
      <p className="text-xs font-medium text-slate-500">{getCustomerDisplayName(project)} • {project.type}</p>
      {description && (
        <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">
          <span className="font-black">Description:</span> {description}
        </p>
      )}
      {estimateDetails && (
        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 whitespace-normal line-clamp-2 max-w-lg">
          <span className="font-black">Estimate:</span> {estimateDetails}
        </p>
      )}
      {completedFileName && (
        <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 w-fit max-w-lg truncate">
          Completed: {completedFileName}
        </p>
      )}
    </div>
  );
};

const ArchiveTableRow = ({ project, onSelectProject }) => (
  <tr className="hover:bg-slate-50 cursor-pointer transition-colors group" onClick={() => onSelectProject(project)}>
    <td className="px-6 py-5">
      <span className="font-bold text-slate-700">{project.completedAt ? formatDateTime(project.completedAt) : '-'}</span>
      <p className="text-[11px] font-semibold text-slate-400 mt-1">{project.completedAt ? new Date(project.completedAt).toLocaleTimeString() : ''}</p>
    </td>
    <td className="px-6 py-5 min-w-[320px]">
      <ArchiveTaskMeta project={project} />
    </td>
    <td className="px-6 py-5 font-medium text-slate-600">{project.location}</td>
    <td className="px-6 py-5 font-medium text-slate-600">{project.assignedTo}</td>
    <td className="px-6 py-5 text-right">
      <div className="flex items-center justify-end gap-2">
        {project.reportSent && (
          <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center mr-2">
            <Check className="w-3 h-3 mr-1" /> Sent
          </span>
        )}
        <button type="button" className="text-indigo-600 bg-indigo-50 group-hover:bg-indigo-600 group-hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm">
          View Files
        </button>
      </div>
    </td>
  </tr>
);

export const HistoryArchiveView = ({ projects, onSelectProject }) => {
  const [filterMonth, setFilterMonth] = useState('All');
  const [filterDate, setFilterDate] = useState('');

  const archived = useMemo(() => (projects || [])
    .filter((project) => project.status === 'Completed')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)), [projects]);

  const uniqueMonths = useMemo(() => [...new Set(archived.map((project) => {
    if (!project.completedAt) return null;
    try {
      return new Date(project.completedAt).toLocaleString('default', { month: 'long', year: 'numeric' });
    } catch (error) {
      return null;
    }
  }).filter(Boolean))], [archived]);

  const filteredArchived = useMemo(() => archived.filter((project) => {
    if (!project.completedAt) return false;
    try {
      const completedDate = new Date(project.completedAt);
      const monthYear = completedDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      const exactDate = getCompletedDateKey(project.completedAt);

      if (filterDate) return exactDate === filterDate;
      if (filterMonth !== 'All') return monthYear === filterMonth;
      return true;
    } catch (error) {
      return false;
    }
  }), [archived, filterDate, filterMonth]);

  return (
    <div className="kalpa-production-polish space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
          onMonthChange={(month) => { setFilterMonth(month); setFilterDate(''); }}
          onDateChange={(date) => { setFilterDate(date); setFilterMonth('All'); }}
          onClear={() => { setFilterMonth('All'); setFilterDate(''); }}
        />
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-100">
              <tr>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Date Completed</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Task Details</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Location</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs">Designer</th>
                <th className="px-6 py-5 font-bold uppercase tracking-wider text-xs text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredArchived.map((project) => (
                <ArchiveTableRow key={project.id} project={project} onSelectProject={onSelectProject} />
              ))}
              {filteredArchived.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400 font-medium">No completed tasks found for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
