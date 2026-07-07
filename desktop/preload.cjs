const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kalpavrikshaDesktop', {
  isDesktop: true,
  platform: process.platform,
  downloadAndOpenFile: (payload) => ipcRenderer.invoke('kv:file:download-open', payload),
  openCachedFile: (payload) => ipcRenderer.invoke('kv:file:open-cached', payload),
  clearCachedFile: (payload) => ipcRenderer.invoke('kv:file:clear-cached', payload),
  pruneExpiredFiles: () => ipcRenderer.invoke('kv:file:prune-expired'),
  onFileTransferProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('kv:file:progress', listener);
    return () => ipcRenderer.removeListener('kv:file:progress', listener);
  },
});
