import { useEffect, useState } from "react"
import Viewer from "./Viewer"

interface ViewerData {
  id: string
  zoomLevel: number
  syncZoom: boolean
}

function App() {
  const [viewers, setViewers] = useState<ViewerData[]>(() => {
    // Load from localStorage on initial render
    const saved = localStorage.getItem('viewers')
    if (saved) {
      return JSON.parse(saved)
    }
    // Default: one viewer with sync off
    return [{ id: '1', zoomLevel: 1, syncZoom: false }]
  })
  
  const [nextId, setNextId] = useState(() => {
    const saved = localStorage.getItem('nextId')
    return saved ? parseInt(saved) : 2
  })

  // Save to localStorage whenever viewers change
  useEffect(() => {
    localStorage.setItem('viewers', JSON.stringify(viewers))
    localStorage.setItem('nextId', nextId.toString())
  }, [viewers, nextId])

  // Calculate global zoom level for synced viewers
  const globalZoomLevel = viewers.find(v => v.syncZoom)?.zoomLevel || 1

  const addViewer = () => {
    const newViewer: ViewerData = {
      id: nextId.toString(),
      zoomLevel: 1,
      syncZoom: false
    }
    setViewers(prev => [...prev, newViewer])
    setNextId(prev => prev + 1)
  }

  const removeViewer = (id: string) => {
    setViewers(prev => prev.filter(v => v.id !== id))
  }

  const updateViewerZoom = (id: string, zoomLevel: number) => {
    setViewers(prev => prev.map(v => 
      v.id === id ? { ...v, zoomLevel } : v
    ))
  }

  const updateViewerSync = (id: string, syncZoom: boolean) => {
    setViewers(prev => prev.map(v => 
      v.id === id ? { ...v, syncZoom } : v
    ))
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px',
        padding: '10px',
        backgroundColor: '#f0f0f0',
        borderRadius: '8px'
      }}>
        <h1 style={{ margin: 0 }}>DICOM Multi-Viewer</h1>
        <button 
          onClick={addViewer}
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Add Viewer
        </button>
      </div>
      
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '20px',
        maxHeight: '80vh',
        overflowY: 'auto'
      }}>
        {viewers.map(viewer => (
          <Viewer
            key={viewer.id}
            id={viewer.id}
            zoomLevel={viewer.zoomLevel}
            onZoomChange={(zoomLevel) => updateViewerZoom(viewer.id, zoomLevel)}
            syncZoom={viewer.syncZoom}
            onSyncToggle={(syncZoom) => updateViewerSync(viewer.id, syncZoom)}
            globalZoomLevel={globalZoomLevel}
            onRemove={() => removeViewer(viewer.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default App
