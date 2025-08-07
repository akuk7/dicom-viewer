import { useEffect, useRef, useState, useCallback } from "react"
import { createLocalImageIds } from "./lib/createImageIdsAndCacheMetaData"
import { RenderingEngine, Enums, type Types, volumeLoader, cornerstoneStreamingImageVolumeLoader } from "@cornerstonejs/core"
import {init as csRenderInit} from "@cornerstonejs/core"
import {init as csToolsInit} from "@cornerstonejs/tools"
import {init as dicomImageLoaderInit} from "@cornerstonejs/dicom-image-loader"
import { 
  ZoomTool, 
  PanTool, 
  addTool, 
  ToolGroupManager, 
  Enums as csToolsEnums
} from "@cornerstonejs/tools"

volumeLoader.registerUnknownVolumeLoader(
  cornerstoneStreamingImageVolumeLoader 
)

interface ViewerProps {
  id: string
  zoomLevel: number
  onZoomChange: (zoomLevel: number, isFromSync?: boolean) => void
  syncZoom: boolean
  onSyncToggle: (syncZoom: boolean) => void
  onRemove: () => void
  isSyncMaster: boolean
}

export default function Viewer({ 
  id, 
  zoomLevel, 
  onZoomChange, 
  syncZoom,
  onSyncToggle,
  onRemove,
  isSyncMaster
}: ViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const runningRef = useRef(false) // Unique ref for each viewer
  const viewportRef = useRef<Types.IStackViewport | null>(null)
  const renderingEngineRef = useRef<RenderingEngine | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const isApplyingZoomRef = useRef(false) // Prevent recursive zoom applications
  const toolGroupRef = useRef<any>(null)
  const syncSourceRef = useRef<string | null>(null) // Track which viewer triggered sync
  const lastZoomLevelRef = useRef<number>(1) // Track last known zoom level for manual detection

  // Handle zoom changes from Cornerstone tools
  const handleZoomChange = useCallback((evt: any) => {
    if (!isInitialized || isApplyingZoomRef.current) {
      return
    }

    try {
      const camera = viewportRef.current?.getCamera()
      if (!camera) {
        return
      }

      const currentScale = camera.parallelScale
      
      // Calculate zoom percentage based on a reasonable scale range
      const baseScale = 150 // This seems to be around the "normal" scale value
      const zoomPercentage = (baseScale / currentScale) * 100
      const zoomDecimal = Math.max(0.01, Math.min(10, zoomPercentage / 100)) // Clamp between 1% and 1000%
      
      // Only trigger sync if this viewer has sync enabled and it's not from a sync operation
      const isFromSync = syncSourceRef.current !== null
      
      onZoomChange(zoomDecimal, isFromSync)
      
    } catch (error) {
      console.warn(`[Viewer ${id}] Zoom change error:`, error)
    }
  }, [onZoomChange, isInitialized, id, syncZoom])

  // Apply zoom level changes from sync (external updates)
  const applySyncZoom = useCallback((targetZoomLevel: number, sourceId: string) => {
    if (!isInitialized || !viewportRef.current || !renderingEngineRef.current) {
      return
    }

    // Skip if this viewer is the source of the sync
    if (sourceId === id) {
      return
    }

    // Apply the zoom level to the viewport
    try {
      isApplyingZoomRef.current = true
      syncSourceRef.current = sourceId
      
      const baseScale = 150
      const targetScale = baseScale / targetZoomLevel
      
      viewportRef.current.setCamera({
        parallelScale: targetScale
      })
      viewportRef.current.render()
      
      // Update the last zoom level ref to prevent manual detection from triggering
      lastZoomLevelRef.current = targetZoomLevel
      
    } catch (error) {
      console.warn(`[Viewer ${id}] Apply zoom error:`, error)
    } finally {
      // Clear sync source and allow new zoom operations
      setTimeout(() => {
        isApplyingZoomRef.current = false
        syncSourceRef.current = null
      }, 10)
    }
  }, [isInitialized, id])

  useEffect(() => {
    const setup = async () => {
      if (runningRef.current) {
        return
      }
      runningRef.current = true
      setIsInitialized(false) // Reset initialization state
      
      await csRenderInit()
      await csToolsInit()
      dicomImageLoaderInit({maxWebWorkers:1})

      // Add zoom and pan tools
      try {
        addTool(ZoomTool)
        addTool(PanTool)
      } catch (error) {
        console.warn('Error adding tools:', error)
      }

      // Get Cornerstone imageIds for local DICOM file
      const imageIds = await createLocalImageIds("/dicom-image.dcm")

      // Instantiate a rendering engine with unique ID
      const renderingEngineId = `renderingEngine_${id}_${Date.now()}`
      const renderingEngine = new RenderingEngine(renderingEngineId)
      renderingEngineRef.current = renderingEngine
      const viewportId = `viewport_${id}_${Date.now()}`

      const viewportInput = {
        viewportId,
        type: Enums.ViewportType.STACK,
        element: elementRef.current,
      }

      renderingEngine.enableElement(viewportInput)

      // Get the stack viewport that was created
      const viewport = renderingEngine.getViewport(viewportId) as Types.IStackViewport
      viewportRef.current = viewport

      // Set the imageIds on the viewport
      await viewport.setStack(imageIds)

      // Create a ToolGroup and add tools
      try {
        if (!ToolGroupManager) {
          console.warn('ToolGroupManager not available')
          return
        }
        
        const toolGroupId = `toolGroup_${id}_${Date.now()}`
        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId)
        toolGroupRef.current = toolGroup
        
        if (toolGroup) {
          toolGroup.addTool(ZoomTool.toolName)
          toolGroup.addTool(PanTool.toolName)

          toolGroup.addViewport(viewportId, renderingEngineId)

          // Set tools to be active with proper bindings
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [
              {
                mouseButton: csToolsEnums.MouseBindings.Secondary, // Right Click
              },
              {
                mouseButton: csToolsEnums.MouseBindings.Primary, // Left Click + Wheel
                modifierKey: csToolsEnums.KeyboardBindings.Ctrl,
              },
            ],
          })

          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [
              {
                mouseButton: csToolsEnums.MouseBindings.Primary, // Left Click
              },
            ],
          })
          
        } else {
          console.warn(`Failed to create ToolGroup for viewer ${id}`)
        }
      } catch (error) {
        console.warn(`ToolGroup creation error for viewer ${id}:`, error)
      }

      // Render the image
      viewport.render()
      
      // Small delay to ensure rendering engine is fully ready
      setTimeout(() => {
        setIsInitialized(true)
      }, 50) // Reduced delay for faster initialization
    }

    setup()

    return () => {
      // Cleanup
      try {
        setIsInitialized(false)
        if (renderingEngineRef.current) {
          renderingEngineRef.current.destroy()
          renderingEngineRef.current = null
        }
        viewportRef.current = null
        toolGroupRef.current = null
        runningRef.current = false
      } catch (error) {
        console.warn('Cleanup error:', error)
      }
    }
  }, [id])

  // Add event listener for zoom changes when viewer is initialized
  useEffect(() => {
    
    if (isInitialized) {
      // Listen for camera modified events to track zoom changes
      const element = elementRef.current
      if (element) {
        element.addEventListener('cornerstonecameramodified', handleZoomChange)
        
        // Also listen for cornerstone events using the eventTarget
        const { eventTarget } = require('@cornerstonejs/core')
        eventTarget.addEventListener('CORNERSTONE_CAMERA_MODIFIED', handleZoomChange)
        
        // Optional: Add wheel support for zooming
        const handleWheel = (e: WheelEvent) => {
          e.preventDefault()
          
          if (!isInitialized || !viewportRef.current || isApplyingZoomRef.current) {
            return
          }
          
          try {
            const delta = e.deltaY > 0 ? 0.9 : 1.1
            const camera = viewportRef.current.getCamera()
            const currentScale = camera.parallelScale
            const newScale = currentScale * delta
            
            viewportRef.current.setCamera({
              parallelScale: newScale
            })
            viewportRef.current.render()
            
            // Manually trigger zoom change detection after a short delay
            setTimeout(() => {
              handleZoomChange({ type: 'manual-zoom' })
            }, 50)
            
          } catch (error) {
            console.warn(`[Viewer ${id}] Wheel zoom error:`, error)
          }
        }
        
        element.addEventListener('wheel', handleWheel)
        
        return () => {
          element.removeEventListener('cornerstonecameramodified', handleZoomChange)
          element.removeEventListener('wheel', handleWheel)
          eventTarget.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', handleZoomChange)
        }
      }
    }
  }, [isInitialized, handleZoomChange, id])

  // Manual zoom detection - periodically check for zoom changes
  useEffect(() => {
    if (!isInitialized || !viewportRef.current) {
      return
    }

    const checkZoomInterval = setInterval(() => {
      try {
        const camera = viewportRef.current?.getCamera()
        if (!camera) return

        const currentScale = camera.parallelScale
        const baseScale = 150
        const currentZoomLevel = baseScale / currentScale
        const zoomDecimal = Math.max(0.01, Math.min(10, currentZoomLevel))

        // Check if zoom has changed significantly
        if (Math.abs(zoomDecimal - lastZoomLevelRef.current) > 0.01) {
          lastZoomLevelRef.current = zoomDecimal
          
          // Only trigger sync if this viewer has sync enabled and it's not from a sync operation
          const isFromSync = syncSourceRef.current !== null
          onZoomChange(zoomDecimal, isFromSync)
        }
      } catch (error) {
        console.warn(`[Viewer ${id}] Manual zoom check error:`, error)
      }
    }, 100) // Check every 100ms

    return () => {
      clearInterval(checkZoomInterval)
    }
  }, [isInitialized, id, onZoomChange])

  // Apply zoom level changes from sync (external updates)
  useEffect(() => {
    
    if (!isInitialized || !viewportRef.current || !renderingEngineRef.current) {
      return
    }

    // Skip if this viewer is the sync master (to prevent applying its own changes back to itself)
    if (isSyncMaster) {
      return
    }

    // Only apply sync if the zoom level has actually changed
    const camera = viewportRef.current.getCamera()
    const currentScale = camera.parallelScale
    const baseScale = 150
    const currentZoomLevel = baseScale / currentScale
    const zoomDifference = Math.abs(zoomLevel - currentZoomLevel)
    
    // Only apply if there's a significant difference (to avoid unnecessary updates)
    if (zoomDifference > 0.01) {
      applySyncZoom(zoomLevel, 'external')
    }
  }, [zoomLevel, isInitialized, id, isSyncMaster, applySyncZoom])

  const resetZoom = () => {
    try {
      if (viewportRef.current && renderingEngineRef.current && isInitialized) {
        // Reset to base scale (100% zoom)
        const baseScale = 150
        
        viewportRef.current.setCamera({
          parallelScale: baseScale
        })
        viewportRef.current.render()
        
        // Update zoom level to 1 (100%)
        onZoomChange(1, false)
        
      }
    } catch (error) {
      console.warn('Reset zoom error:', error)
    }
  }

  return (
    <div style={{ 
      border: '2px solid #ccc', 
      borderRadius: '8px', 
      padding: '10px',
      backgroundColor: '#f9f9f9',
      minWidth: '300px'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '10px' 
      }}>
        <span style={{ fontWeight: 'bold' }}>Viewer {id}</span>
        <button 
          onClick={onRemove}
          style={{
            padding: '2px 8px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Remove
        </button>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <span>Zoom: {(zoomLevel * 100).toFixed(0)}%</span>
        <button 
          onClick={resetZoom}
          style={{
            padding: '3px 8px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          Reset
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={syncZoom}
            onChange={(e) => onSyncToggle(e.target.checked)}
          />
          Sync
        </label>
      </div>
      
      <div
        ref={elementRef}
        style={{
          width: "300px",
          height: "300px",
          backgroundColor: "#000",
        }}
      ></div>
    </div>
  )
}