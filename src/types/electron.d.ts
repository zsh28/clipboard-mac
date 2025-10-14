interface ClipboardItem {
  id: string
  content: string
  type: 'text' | 'image' | 'html'
  timestamp: number
  preview?: string
}

interface ElectronAPI {
  getClipboardHistory: () => Promise<ClipboardItem[]>
  copyToClipboard: (item: ClipboardItem) => Promise<void>
  deleteClipboardItem: (id: string) => Promise<ClipboardItem[]>
  clearClipboardHistory: () => Promise<ClipboardItem[]>
  hideWindow: () => Promise<void>
  getAutoPasteSetting: () => Promise<boolean>
  setAutoPasteSetting: (enabled: boolean) => Promise<boolean>
  onClipboardUpdated: (callback: (history: ClipboardItem[]) => void) => () => void
  onPasteFeedback: (callback: (feedback: { success: boolean, message: string }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}