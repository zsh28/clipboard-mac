import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
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
  private store: Store<{ history: ClipboardItem[], autoPaste: boolean }>
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private clipboardHistory: ClipboardItem[] = []
  private lastTextContent: string = ''
  private lastImageHash: string = ''
  private lastHtmlContent: string = ''
  private pollInterval: NodeJS.Timeout | null = null
  private isInternalCopy: boolean = false
  private autoPasteEnabled: boolean = true
  private previousActiveApp: string = ''

  constructor() {
    this.store = new Store<{ history: ClipboardItem[], autoPaste: boolean }>({
      name: 'clipboard-history',
      defaults: {
        history: [] as ClipboardItem[],
        autoPaste: true
      }
    })
    this.loadHistory()
    this.autoPasteEnabled = this.store.get('autoPaste', true)
  }

  private checkIfTextFieldActive(): boolean {
    try {
      if (process.platform === 'darwin') {
        const result = execSync(`osascript -e 'tell application "System Events" to get focused of UI element 1 of process "${this.previousActiveApp}"'`).toString().trim()
        return result === 'true'
      }
    } catch {
      return true
    }
    return true
  }

  private simulatePaste() {
    try {
      setTimeout(() => {
        if (process.platform === 'darwin') {
          try {
            if (this.previousActiveApp && this.previousActiveApp !== 'Clipboard Manager') {
              try {
                execSync(`osascript -e 'tell application "${this.previousActiveApp}" to activate'`)
                
                setTimeout(() => {
                  try {
                    this.checkIfTextFieldActive()
                    execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`)
                    
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                      this.mainWindow.webContents.send('paste-feedback', { 
                        success: true, 
                        message: 'Content pasted successfully' 
                      })
                    }
                   } catch {
                     if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                       this.mainWindow.webContents.send('paste-feedback', { 
                         success: false, 
                         message: 'Paste operation failed - ensure a text field is active' 
                       })
                     }
                   }
                }, 500)
               } catch {
                 try {
                   execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`)
                   
                   if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                     this.mainWindow.webContents.send('paste-feedback', { 
                       success: true, 
                       message: 'Content pasted (fallback method)' 
                     })
                   }
                 } catch {
                   if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                     this.mainWindow.webContents.send('paste-feedback', { 
                       success: false, 
                       message: 'Paste failed - please try pasting manually (Cmd+V)' 
                     })
                   }
                 }
               }
            } else {
              const frontAppResult = execSync(`osascript -e 'tell application "System Events" to return name of first application process whose frontmost is true'`).toString().trim()
              
              if (frontAppResult === "Finder") {
                return
              }
              
              execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`)
              
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('paste-feedback', { 
                  success: true, 
                  message: 'Content pasted successfully' 
                })
              }
            }
            
          } catch {
            // Silent error handling
          }
        } else if (process.platform === 'win32') {
          try {
            execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"`)
          } catch {
            // Silent error handling
          }
        } else {
          try {
            execSync('xdotool key ctrl+v')
          } catch {
            // Silent error handling
          }
        }
      }, 300)
    } catch {
      // Silent error handling
    }
  }

  private storePreviousActiveApp() {
    if (process.platform === 'darwin') {
      try {
        const frontApp = execSync(`osascript -e 'tell application "System Events" to return name of first application process whose frontmost is true'`).toString().trim()
        if (frontApp !== 'Clipboard Manager') {
          this.previousActiveApp = frontApp
        }
      } catch  {
        // Silent error handling
      }
    }
  }

  private loadHistory() {
    this.clipboardHistory = this.store.get('history', []) as ClipboardItem[]
  }

  private saveHistory() {
    this.store.set('history', this.clipboardHistory.slice(0, 100)) // Keep last 100 items
  }

  private addToHistory(content: string, type: 'text' | 'image' | 'html') {
    if (!content) return

    if (this.isInternalCopy) {
      return
    }

    const recentItems = this.clipboardHistory.slice(0, 3)
    for (const item of recentItems) {
      if (item.content === content && item.type === type) {
        return
      }
    }

    const item: ClipboardItem = {
      id: Date.now().toString(),
      content,
      type,
      timestamp: Date.now(),
      preview: type === 'text' ? content.substring(0, 100) : 
               type === 'image' ? 'Image' : 
               type === 'html' ? content.replace(/<[^>]*>/g, '').substring(0, 100) :
               `${type} content`
    }

    this.clipboardHistory.unshift(item)
    this.clipboardHistory = this.clipboardHistory.slice(0, 100)
    this.saveHistory()

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('clipboard-updated', this.clipboardHistory)
    }
  }

  private startClipboardMonitoring() {
    this.lastTextContent = clipboard.readText()
    this.lastHtmlContent = clipboard.readHTML()
    
    this.pollInterval = setInterval(() => {
      if (this.isInternalCopy) {
        return
      }

      let hasNewContent = false
      
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG()
        const imageHash = createHash('md5').update(imageBuffer).digest('hex')
        
        if (imageHash !== this.lastImageHash) {
          const imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`
          this.addToHistory(imageBase64, 'image')
          this.lastImageHash = imageHash
          hasNewContent = true
        }
      }
      
      if (!hasNewContent) {
        const html = clipboard.readHTML()
        const text = clipboard.readText()
        
        const isActualHTML = html && 
                            html.trim() && 
                            html !== text && 
                            html.includes('<') && 
                            html.includes('>') &&
                            (html.match(/<[^>]+>/g) || []).length > 2
        
        const currentContent = isActualHTML ? html : text
        const contentType = isActualHTML ? 'html' : 'text'
        
        const lastContent = contentType === 'html' ? this.lastHtmlContent : this.lastTextContent
        
        if (currentContent && currentContent !== lastContent) {
          this.addToHistory(currentContent, contentType as 'text' | 'html')
          
          if (contentType === 'html') {
            this.lastHtmlContent = currentContent
          } else {
            this.lastTextContent = currentContent
          }
        }
      }
    }, 300)
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
    // Create icon for menu bar with proper template image support
    const icon = nativeImage.createFromPath(join(__dirname, '../public/clipboard.png'))
    
    // Ensure the icon is properly sized and set as template
    const resizedIcon = icon.resize({ width: 16, height: 16 })
    resizedIcon.setTemplateImage(true) // This makes it adapt to dark/light menu bar automatically
    
    this.tray = new Tray(resizedIcon)
    
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
      // Store the current active app before showing our window
      this.storePreviousActiveApp()
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
      this.isInternalCopy = true
      
      if (item.type === 'image') {
        const base64Data = item.content.replace('data:image/png;base64,', '')
        const imageBuffer = Buffer.from(base64Data, 'base64')
        const image = nativeImage.createFromBuffer(imageBuffer)
        clipboard.writeImage(image)
        this.lastImageHash = createHash('md5').update(imageBuffer).digest('hex')
      } else if (item.type === 'html') {
        clipboard.writeHTML(item.content)
        this.lastHtmlContent = item.content
        this.lastTextContent = item.content
      } else {
        clipboard.writeText(item.content)
        this.lastTextContent = item.content
      }
      
      setTimeout(() => {
        this.isInternalCopy = false
      }, 100)

      this.hideWindow()
      
      if (this.autoPasteEnabled) {
        this.simulatePaste()
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

    ipcMain.handle('get-auto-paste-setting', () => {
      return this.autoPasteEnabled
    })

    ipcMain.handle('set-auto-paste-setting', (_, enabled: boolean) => {
      this.autoPasteEnabled = enabled
      this.store.set('autoPaste', enabled)
      return enabled
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