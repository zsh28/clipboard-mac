// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron')

interface ClipboardItem {
  id: string
  content: string
  type: 'text' | 'image' | 'html'
  timestamp: number
  preview?: string
}

const electronAPI = {
  getClipboardHistory: (): Promise<ClipboardItem[]> => {
    console.log('Preload: getClipboardHistory called')
    return ipcRenderer.invoke('get-clipboard-history')
  },
  
  copyToClipboard: (item: ClipboardItem): Promise<void> => {
    console.log('Preload: copyToClipboard called with:', item.type, item.content.substring(0, 50))
    return ipcRenderer.invoke('copy-to-clipboard', item)
  },
  
  deleteClipboardItem: (id: string): Promise<ClipboardItem[]> => {
    console.log('Preload: deleteClipboardItem called with id:', id)
    return ipcRenderer.invoke('delete-clipboard-item', id)
  },
  
  clearClipboardHistory: (): Promise<ClipboardItem[]> => {
    console.log('Preload: clearClipboardHistory called')
    return ipcRenderer.invoke('clear-clipboard-history')
  },
  
  hideWindow: (): Promise<void> => {
    console.log('Preload: hideWindow called')
    return ipcRenderer.invoke('hide-window')
  },

  onClipboardUpdated: (callback: (history: ClipboardItem[]) => void) => {
    console.log('Preload: Setting up clipboard update listener')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer.on('clipboard-updated', (_event: any, history: ClipboardItem[]) => {
      console.log('Preload: Received clipboard-updated event with', history.length, 'items')
      callback(history)
    })
    return () => {
      console.log('Preload: Removing clipboard update listener')
      ipcRenderer.removeAllListeners('clipboard-updated')
    }
  }
}

console.log('Preload script loaded, exposing electronAPI to main world')
contextBridge.exposeInMainWorld('electronAPI', electronAPI)