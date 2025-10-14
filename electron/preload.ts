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
    return ipcRenderer.invoke('get-clipboard-history')
  },
  
  copyToClipboard: (item: ClipboardItem): Promise<void> => {
    return ipcRenderer.invoke('copy-to-clipboard', item)
  },
  
  deleteClipboardItem: (id: string): Promise<ClipboardItem[]> => {
    return ipcRenderer.invoke('delete-clipboard-item', id)
  },
  
  clearClipboardHistory: (): Promise<ClipboardItem[]> => {
    return ipcRenderer.invoke('clear-clipboard-history')
  },
  
  hideWindow: (): Promise<void> => {
    return ipcRenderer.invoke('hide-window')
  },

  getAutoPasteSetting: (): Promise<boolean> => {
    return ipcRenderer.invoke('get-auto-paste-setting')
  },

  setAutoPasteSetting: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('set-auto-paste-setting', enabled)
  },

  onClipboardUpdated: (callback: (history: ClipboardItem[]) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer.on('clipboard-updated', (_event: any, history: ClipboardItem[]) => {
      callback(history)
    })
    return () => {
      ipcRenderer.removeAllListeners('clipboard-updated')
    }
  },

  onPasteFeedback: (callback: (feedback: { success: boolean, message: string }) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer.on('paste-feedback', (_event: any, feedback: { success: boolean, message: string }) => {
      callback(feedback)
    })
    return () => {
      ipcRenderer.removeAllListeners('paste-feedback')
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)