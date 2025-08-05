import { useEffect, useState, useRef } from "react"
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
    // Default: one viewer
    return [{ id: '1', zoomLevel: 1, syncZoom: false }]
  })
  
  const [nextId, setNextId] = useState(() => {
    const saved = localStorage.getItem('nextId')
    return saved ? parseInt(saved) : 2
  })

  // Track which viewer is currently the "sync master" to prevent infinite loops
  const syncMasterRef = useRef<string | null>(null)

  // Save to localStorage whenever viewers change
  useEffect(() => {
    localStorage.setItem('viewers', JSON.stringify(viewers))
    localStorage.setItem('nextId', nextId.toString())
  }, [viewers, nextId])

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

  const updateViewerZoom = (id: string, zoomLevel: number, isFromSync: boolean = false) => {
    setViewers(prev => {
      const updatedViewers = prev.map(v => 
        v.id === id ? { ...v, zoomLevel } : v
      )
      
      // If this update is from a sync operation, don't trigger further syncing
      if (isFromSync) {
        return updatedViewers
      }
      
      // Find the viewer that triggered this change
      const triggeringViewer = updatedViewers.find(v => v.id === id)
      
      // If the triggering viewer has sync enabled, update all other sync-enabled viewers
      if (triggeringViewer?.syncZoom) {
        // Set this viewer as the sync master to prevent loops
        syncMasterRef.current = id
        
        return updatedViewers.map(v => 
          v.id !== id && v.syncZoom ? { ...v, zoomLevel } : v
        )
      }
      
      return updatedViewers
    })

    // Clear sync master after a brief delay
    setTimeout(() => {
      syncMasterRef.current = null
    }, 10)
  }

  const updateViewerSync = (id: string, syncZoom: boolean) => {
    setViewers(prev => {
      const updatedViewers = prev.map(v => 
        v.id === id ? { ...v, syncZoom } : v
      )
      
      // If sync is being enabled, sync this viewer to match other sync-enabled viewers
      if (syncZoom) {
        // Find the first sync-enabled viewer (excluding the one being updated)
        const syncEnabledViewer = updatedViewers.find(v => v.id !== id && v.syncZoom)
        
        if (syncEnabledViewer) {
          // Set the newly sync-enabled viewer to match the zoom level of existing sync viewers
          return updatedViewers.map(v => 
            v.id === id ? { ...v, zoomLevel: syncEnabledViewer.zoomLevel } : v
          )
        }
      }
      
      return updatedViewers
    })
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
            onZoomChange={(zoomLevel, isFromSync) => updateViewerZoom(viewer.id, zoomLevel, isFromSync)}
            syncZoom={viewer.syncZoom}
            onSyncToggle={(syncZoom) => updateViewerSync(viewer.id, syncZoom)}
            onRemove={() => removeViewer(viewer.id)}
            isSyncMaster={syncMasterRef.current === viewer.id}
          />
        ))}
      </div>
    </div>
  )
}

export default App