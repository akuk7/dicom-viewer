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
      const loadedViewers = JSON.parse(saved)
      // Ensure IDs are sequential when loading from localStorage
      return loadedViewers.map((viewer: ViewerData, index: number) => ({
        ...viewer,
        id: (index + 1).toString()
      }))
    }
    // Default: one viewer
    return [{ id: '1', zoomLevel: 1, syncZoom: false }]
  })

  // Track which viewer triggered the sync to prevent loops
  const syncSourceRef = useRef<string | null>(null)

  // Save to localStorage whenever viewers change
  useEffect(() => {
    localStorage.setItem('viewers', JSON.stringify(viewers))
  }, [viewers])

  // Helper function to reorder IDs sequentially
  const reorderViewerIds = (viewersList: ViewerData[]): ViewerData[] => {
    return viewersList.map((viewer, index) => ({
      ...viewer,
      id: (index + 1).toString()
    }))
  }

  const addViewer = () => {
    const newId = (viewers.length + 1).toString()
    const newViewer = {
      id: newId,
      zoomLevel: 1,
      syncZoom: false
    }
    setViewers(prev => [...prev, newViewer])
  }

  const removeViewer = (id: string) => {
    setViewers(prev => {
      // Remove the viewer
      const filteredViewers = prev.filter(viewer => viewer.id !== id)
      
      // Reorder IDs to be sequential (1, 2, 3, ...)
      return reorderViewerIds(filteredViewers)
    })
  }

  const updateViewerZoom = (id: string, newZoomLevel: number, isFromSync?: boolean) => {
    setViewers(prev => {
      const updatedViewers = prev.map(viewer => 
        viewer.id === id ? { ...viewer, zoomLevel: newZoomLevel } : viewer
      )
      
      // If this zoom change is not from a sync operation, propagate to other sync-enabled viewers
      if (!isFromSync) {
        const triggeringViewer = updatedViewers.find(v => v.id === id)
        if (triggeringViewer && triggeringViewer.syncZoom) {
          // Find other viewers with sync enabled
          const otherSyncViewers = updatedViewers.filter(v => 
            v.id !== id && v.syncZoom
          )
          
          // Update all other sync-enabled viewers
          otherSyncViewers.forEach(syncViewer => {
            const index = updatedViewers.findIndex(v => v.id === syncViewer.id)
            if (index !== -1) {
              updatedViewers[index] = { ...syncViewer, zoomLevel: newZoomLevel }
            }
          })
        }
      }
      
      return updatedViewers
    })
  }

  const updateViewerSync = (id: string, syncZoom: boolean) => {
    setViewers(prev => {
      const updatedViewers = prev.map(viewer => 
        viewer.id === id ? { ...viewer, syncZoom } : viewer
      )
      
      // If sync is being enabled, match zoom levels with other sync-enabled viewers
      if (syncZoom) {
        const otherSyncViewers = updatedViewers.filter(v => 
          v.id !== id && v.syncZoom
        )
        
        if (otherSyncViewers.length > 0) {
          // Use the first sync-enabled viewer's zoom level
          const targetZoom = otherSyncViewers[0].zoomLevel
          
          // Update the current viewer to match
          const currentViewerIndex = updatedViewers.findIndex(v => v.id === id)
          if (currentViewerIndex !== -1) {
            updatedViewers[currentViewerIndex] = { 
              ...updatedViewers[currentViewerIndex], 
              zoomLevel: targetZoom 
            }
          }
        }
      }
      
      return updatedViewers
    })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px' 
      }}>
        <h1 style={{ margin: 0 }}>DICOM Multi-Viewer</h1>
        <button 
          onClick={addViewer}
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
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
            isSyncMaster={syncSourceRef.current === viewer.id}
          />
        ))}
      </div>
    </div>
  )
}

export default App