import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import Store from 'electron-store'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface ClipboardItem {
  id: string
  content: string
  type: 'text' | 'image' | 'html'
  timestamp: number
  preview?: string
}

class ClipboardManager {
  private store: Store<{ history: ClipboardItem[] }>
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private clipboardHistory: ClipboardItem[] = []
  private lastTextContent: string = ''
  private lastImageHash: string = ''
  private pollInterval: NodeJS.Timeout | null = null

  constructor() {
    this.store = new Store<{ history: ClipboardItem[] }>({
      name: 'clipboard-history',
      defaults: {
        history: [] as ClipboardItem[]
      }
    })
    this.loadHistory()
  }

  private loadHistory() {
    this.clipboardHistory = this.store.get('history', []) as ClipboardItem[]
  }

  private saveHistory() {
    this.store.set('history', this.clipboardHistory.slice(0, 100)) // Keep last 100 items
  }

  private addToHistory(content: string, type: 'text' | 'image' | 'html') {
    if (!content) return

    // Check if this content is identical to the most recent item
    if (this.clipboardHistory.length > 0) {
      const lastItem = this.clipboardHistory[0]
      if (lastItem.content === content && lastItem.type === type) {
        console.log('Skipping duplicate content')
        return
      }
    }

    console.log('Adding to history:', type === 'image' ? 'Image data' : content.substring(0, 50), 'Type:', type)

    const item: ClipboardItem = {
      id: Date.now().toString(),
      content,
      type,
      timestamp: Date.now(),
      preview: type === 'text' ? content.substring(0, 100) : 
               type === 'image' ? 'Image' : 
               `${type} content`
    }

    this.clipboardHistory.unshift(item)
    this.clipboardHistory = this.clipboardHistory.slice(0, 100)
    this.saveHistory()

    console.log('History updated. Total items:', this.clipboardHistory.length)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      console.log('Sending update to renderer')
      this.mainWindow.webContents.send('clipboard-updated', this.clipboardHistory)
    }
  }

  private startClipboardMonitoring() {
    // Get initial clipboard content
    this.lastTextContent = clipboard.readText()
    console.log('Starting clipboard monitoring. Initial content:', this.lastTextContent?.substring(0, 50))
    
    this.pollInterval = setInterval(() => {
      let hasNewContent = false
      
      // Check for images first - images take priority over text
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG()
        const imageHash = createHash('md5').update(imageBuffer).digest('hex')
        
        if (imageHash !== this.lastImageHash) {
          console.log('New image content detected')
          const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`
          this.addToHistory(imageBase64, 'image')
          this.lastImageHash = imageHash
          hasNewContent = true
        }
      }
      
      // Only check for text if no new image was found
      if (!hasNewContent) {
        const text = clipboard.readText()
        if (text && text !== this.lastTextContent) {
          console.log('New text content detected:', text.substring(0, 50))
          this.addToHistory(text, 'text')
          this.lastTextContent = text
        }
      }
    }, 500)
  }

  private stopClipboardMonitoring() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 600,
      height: 700,
      show: false, // Always start hidden for menu bar app
      frame: false, // Frameless for a cleaner look
      transparent: true,
      resizable: true,
      skipTaskbar: true, // Don't show in taskbar
      alwaysOnTop: true, // Keep on top when shown
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173')
      this.mainWindow.webContents.openDevTools()
      this.mainWindow.show() // Show in development for easier debugging
    } else {
      this.mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }

    this.mainWindow.on('blur', () => {
      this.hideWindow()
    })
  }

  createTray() {
    // Use a template image for better menu bar integration
    const icon = nativeImage.createFromPath(join(__dirname, '../public/clipboard.png'))
    icon.setTemplateImage(true) // This makes it adapt to dark/light menu bar
    this.tray = new Tray(icon.resize({ width: 16, height: 16 }))
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Clipboard',
        click: () => this.showWindow()
      },
      {
        label: 'Clear History',
        click: () => this.clearHistory()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      }
    ])

    this.tray.setContextMenu(contextMenu)
    this.tray.setToolTip('Clipboard Manager')
    
    this.tray.on('click', () => {
      this.toggleWindow()
    })
  }

  showWindow() {
    if (this.mainWindow) {
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send('clipboard-updated', this.clipboardHistory)
    }
  }

  hideWindow() {
    if (this.mainWindow) {
      this.mainWindow.hide()
    }
  }

  toggleWindow() {
    if (this.mainWindow?.isVisible()) {
      this.hideWindow()
    } else {
      this.showWindow()
    }
  }

  clearHistory() {
    this.clipboardHistory = []
    this.saveHistory()
    if (this.mainWindow) {
      this.mainWindow.webContents.send('clipboard-updated', this.clipboardHistory)
    }
  }

  setupIPC() {
    ipcMain.handle('get-clipboard-history', () => {
      return this.clipboardHistory
    })

    ipcMain.handle('copy-to-clipboard', (_, item: { content: string, type: string }) => {
      if (item.type === 'image') {
        // Extract base64 data and convert back to image
        const base64Data = item.content.replace('data:image/png;base64,', '')
        const imageBuffer = Buffer.from(base64Data, 'base64')
        const image = nativeImage.createFromBuffer(imageBuffer)
        clipboard.writeImage(image)
        this.lastImageHash = createHash('md5').update(imageBuffer).digest('hex')
      } else {
        clipboard.writeText(item.content)
        this.lastTextContent = item.content
      }
    })

    ipcMain.handle('delete-clipboard-item', (_, id: string) => {
      this.clipboardHistory = this.clipboardHistory.filter(item => item.id !== id)
      this.saveHistory()
      return this.clipboardHistory
    })

    ipcMain.handle('clear-clipboard-history', () => {
      this.clearHistory()
      return this.clipboardHistory
    })

    ipcMain.handle('hide-window', () => {
      this.hideWindow()
    })
  }

  setupGlobalShortcuts() {
    globalShortcut.register('CommandOrControl+Shift+V', () => {
      this.toggleWindow()
    })
  }

  init() {
    this.createWindow()
    this.createTray()
    this.setupIPC()
    this.setupGlobalShortcuts()
    this.startClipboardMonitoring()
  }

  cleanup() {
    this.stopClipboardMonitoring()
    globalShortcut.unregisterAll()
  }
}

const clipboardManager = new ClipboardManager()

app.whenReady().then(() => {
  // Hide app from dock (menu bar app only)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }
  clipboardManager.init()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  clipboardManager.cleanup()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    clipboardManager.init()
  }
})