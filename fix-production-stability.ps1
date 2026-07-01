$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

$root = Get-Location
$appFiles = @(
  Join-Path $root 'frontend/src/App.jsx',
  Join-Path $root 'src/App.jsx'
) | Where-Object { Test-Path $_ }

if ($appFiles.Count -eq 0) {
  throw "No App.jsx files found. Run this script from the project root."
}

$activeToastsComponent = @'
const ActiveToasts = ({ notifications = [], currentUser }) => {
  if (!currentUser) return null;
  const visible = (notifications || [])
    .filter(n => ((!n.targetUser && n.targetRole === currentUser.role) || n.targetUser === currentUser.name))
    .filter(n => !(n.readBy || []).includes(currentUser.name))
    .slice(0, 2);

  if (visible.length === 0) return null;

  return (
    <div className="fixed top-24 right-5 z-[60] space-y-3 pointer-events-none">
      {visible.map(n => (
        <div key={n.id} className="bg-white border-2 border-indigo-100 shadow-2xl rounded-2xl p-4 max-w-xs animate-in slide-in-from-right-4">
          <p className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-1">Notification</p>
          <p className="text-sm font-extrabold text-slate-800">{n.title || n.message || 'Notification'}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">{n.time || n.createdAt || ''}</p>
        </div>
      ))}
    </div>
  );
};

'@

$appErrorBoundaryComponent = @'
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' };
  }
  componentDidCatch(error, info) {
    try {
      const logs = JSON.parse(localStorage.getItem('kd-error-logs') || '[]');
      logs.unshift({ at: new Date().toISOString(), message: error?.message || String(error), stack: error?.stack || '', componentStack: info?.componentStack || '' });
      localStorage.setItem('kd-error-logs', JSON.stringify(logs.slice(0, 50)));
    } catch (_) {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="max-w-xl w-full bg-white border border-red-100 rounded-3xl shadow-xl p-8 text-center">
            <div className="mx-auto mb-6 w-20 h-20 rounded-3xl bg-red-50 flex items-center justify-center text-red-500 text-4xl font-black">!</div>
            <h1 className="text-2xl font-black text-slate-900 mb-3">Something needs attention</h1>
            <p className="text-slate-500 font-semibold mb-5">The page did not load correctly, but your data is safe. Refresh the page once. If it repeats, check the saved error log.</p>
            <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm font-black text-red-500 mb-6">{this.state.message}</div>
            <button type="button" onClick={() => window.location.reload()} className="px-6 py-3 rounded-2xl bg-slate-900 text-white font-black shadow-lg">Refresh Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

'@

foreach ($file in $appFiles) {
  Write-Step "Stabilizing $file"
  $content = Get-Content -Raw -Path $file

  # Repair common mojibake caused by UTF-8 text being interpreted as Windows-1252/ANSI.
  $content = $content.Replace('â‚¹', '₹')
  $content = $content.Replace('â€¢', '•')
  $content = $content.Replace('â€™', "'")
  $content = $content.Replace('â€˜', "'")
  $content = $content.Replace('â€œ', '"')
  $content = $content.Replace('â€', '"')
  $content = $content.Replace('â€“', '-')
  $content = $content.Replace('â€”', '-')
  $content = $content.Replace('Â·', '·')
  $content = $content.Replace('Â ', ' ')

  # JSX component names must be capitalized.
  $content = $content -replace '<activeToasts([^>]*)/>', '<ActiveToasts$1/>'
  $content = $content -replace '<activeToasts([^>]*)>', '<ActiveToasts$1>'
  $content = $content -replace '</activeToasts>', '</ActiveToasts>'

  # Restore toast component if it was removed during modularization.
  if ($content -notmatch 'const\s+ActiveToasts\s*=') {
    if ($content -match 'class\s+AppErrorBoundary\s+extends') {
      $content = $content -replace 'class\s+AppErrorBoundary\s+extends', ($activeToastsComponent + 'class AppErrorBoundary extends')
    } elseif ($content -match 'const\s+AppShell\s*=') {
      $content = $content -replace 'const\s+AppShell\s*=', ($activeToastsComponent + 'const AppShell =')
    } else {
      throw "Could not find insertion point for ActiveToasts in $file"
    }
  }

  # Restore error boundary if it was removed during modularization.
  if ($content -notmatch 'class\s+AppErrorBoundary\s+extends') {
    if ($content -match 'const\s+App\s*=') {
      $content = $content -replace 'const\s+App\s*=', ($appErrorBoundaryComponent + 'const App =')
    } elseif ($content -match 'const\s+AppShell\s*=') {
      $content = $content -replace 'const\s+AppShell\s*=', ($appErrorBoundaryComponent + 'const AppShell =')
    } else {
      throw "Could not find insertion point for AppErrorBoundary in $file"
    }
  }

  # Ensure rendered toast uses correct component name.
  $content = $content -replace '<activeToasts\s+', '<ActiveToasts '

  [System.IO.File]::WriteAllText($file, $content, [System.Text.UTF8Encoding]::new($false))
}

Write-Step "Done. Now run: npm run build; cd frontend; npm run build"
