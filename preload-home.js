// Bridge for the in-game Home menu overlay (renderer/home.html): it only receives what to show and reports the choice.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('home', {
  onOpen: fn => ipcRenderer.on('home:open', (e, d) => fn(d)),
  onButton: fn => ipcRenderer.on('home:button', (e, d) => fn(d)),
  onToast: fn => ipcRenderer.on('home:toast', (e, t) => fn(t)),
  onPaused: fn => ipcRenderer.on('home:paused', (e, p) => fn(p)),
  // (beta.14) Achievements: the item joins the open menu when main knows the game has some; the list, read-only
  onAch: fn => ipcRenderer.on('home:ach', (e, d) => fn(d)),
  achList: force => ipcRenderer.invoke('home:achList', !!force).then(r => { if (r && r.ok) return r.data; throw new Error((r && r.error) || 'The achievements did not load.'); }),
  act: action => ipcRenderer.send('home:act', String(action))
});
