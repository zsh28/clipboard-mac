import { useState, useEffect } from 'react'
import './App.css'

interface ClipboardItem {
  id: string
  content: string
  type: 'text' | 'image' | 'html'
  timestamp: number
  preview?: string
}

function App() {
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    console.log('App component mounted')
    console.log('window.electronAPI available:', !!window.electronAPI)
    
    const loadHistory = async () => {
      try {
        if (window.electronAPI) {
          console.log('Loading initial clipboard history...')
          const history = await window.electronAPI.getClipboardHistory()
          console.log('Initial history loaded:', history.length, 'items')
          setClipboardHistory(history)
        } else {
          console.error('electronAPI not available on window object')
        }
      } catch (error) {
        console.error('Failed to load clipboard history:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadHistory()

    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.onClipboardUpdated((history: ClipboardItem[]) => {
        console.log('Clipboard updated event received:', history.length, 'items')
        setClipboardHistory(history)
      })
      return unsubscribe
    }
  }, [])

  const filteredHistory = clipboardHistory.filter(item => {
    if (item.type === 'image') {
      return searchTerm === '' || 'image'.includes(searchTerm.toLowerCase())
    }
    return item.content.toLowerCase().includes(searchTerm.toLowerCase())
  })

  const handleCopyItem = async (item: ClipboardItem) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyToClipboard(item)
        await window.electronAPI.hideWindow()
      }
    } catch (error) {
      console.error('Failed to copy item:', error)
    }
  }

  const handleDeleteItem = async (id: string) => {
    try {
      if (window.electronAPI) {
        const updatedHistory = await window.electronAPI.deleteClipboardItem(id)
        setClipboardHistory(updatedHistory)
      }
    } catch (error) {
      console.error('Failed to delete item:', error)
    }
  }

  const handleClearHistory = async () => {
    try {
      if (window.electronAPI) {
        const clearedHistory = await window.electronAPI.clearClipboardHistory()
        setClipboardHistory(clearedHistory)
      }
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'Just now'
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`
    return date.toLocaleDateString()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && window.electronAPI) {
      window.electronAPI.hideWindow()
    }
  }

  if (isLoading) {
    return (
      <div className="app loading">
        <div className="loading-spinner">Loading...</div>
      </div>
    )
  }

  return (
    <div className="app" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="header">
        <h1 className="title">Clipboard Manager</h1>
        <div className="search-container">
          <input
            type="text"
            placeholder="Search clipboard history..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
            autoFocus
          />
        </div>
        <div className="header-actions">
          <button onClick={handleClearHistory} className="clear-button">
            Clear All
          </button>
        </div>
      </div>

      <div className="clipboard-list">
        {filteredHistory.length === 0 ? (
          <div className="empty-state">
            {searchTerm ? 'No matching items found' : 'No clipboard history yet'}
          </div>
        ) : (
          filteredHistory.map((item) => (
            <div
              key={item.id}
              className="clipboard-item"
              onClick={() => handleCopyItem(item)}
            >
              <div className="item-content">
                <div className="item-preview">
                  {item.type === 'image' ? (
                    <div className="image-preview">
                      <img 
                        src={item.content} 
                        alt="Clipboard image" 
                        className="clipboard-image"
                        onError={() => console.log('Image failed to load')}
                      />
                    </div>
                  ) : (
                    item.preview || item.content
                  )}
                </div>
                <div className="item-meta">
                  <span className="item-type">{item.type}</span>
                  <span className="item-timestamp">
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
              </div>
              <button
                className="delete-button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteItem(item.id)
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="footer">
        <div className="shortcut-hint">
          Press <kbd>Cmd+Shift+V</kbd> to toggle • <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}

export default App
