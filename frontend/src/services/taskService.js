export const getStatusColor = (status) => {
  switch (status) {
    case 'Lead Received': return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'Drafting': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Internal Review': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'Completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const getPriorityColor = (priority, dueDate) => {
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'text-red-700 bg-red-100 border-red-300 animate-pulse';
  switch (priority) {
    case 'Urgent': return 'text-red-600 bg-red-50 border-red-200';
    case 'High': return 'text-orange-600 bg-orange-50 border-orange-200';
    default: return 'text-slate-600 bg-slate-50 border-slate-200';
  }
};
