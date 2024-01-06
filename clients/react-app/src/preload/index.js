import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  electrumRequest: (payout) => ipcRenderer.invoke('electrum-request', payout),
  infoConfig: () => ipcRenderer.invoke('info-config'),
  getConfigFile: () => ipcRenderer.invoke('get-config-file'),
  syncWallets: async (payout) => await ipcRenderer.invoke('sync-wallets', payout),
  getWallets: () => ipcRenderer.invoke('get-wallets'),
  getToken: () => ipcRenderer.invoke('get-token'),
  initPod: (payout) => ipcRenderer.invoke('init-pod', payout),
  signFirst: (payout) => ipcRenderer.invoke('sign-first', payout),
  signSecond: (payout) => ipcRenderer.invoke('sign-second', payout),
  convertAddressToReversedHash: (payout) => ipcRenderer.invoke('convert-address-to-reversed-hash', payout),
  syncBackupTxs: async (payout) => await ipcRenderer.invoke('sync-backup-txs', payout),
  getAllBackupTxs: () => ipcRenderer.invoke('get-all-backup-txs')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
