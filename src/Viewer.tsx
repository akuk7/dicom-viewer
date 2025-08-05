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
  const eventListenerAdded = useRef(false) // Track if event listener is added
  const lastAppliedZoomRef = useRef<number>(zoomLevel) // Track last applied zoom level
  const isApplyingZoomRef = useRef(false) // Prevent recursive zoom applications

  // Define handleWheel at component scope so it can be referenced in cleanup
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    
    // Only proceed if viewer is fully initialized
    if (!isInitialized || !viewportRef.current || !renderingEngineRef.current || isApplyingZoomRef.current) {
      return
    }
    
    // Use Cornerstone's built-in zoom functionality
    try {
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const camera = viewportRef.current.getCamera()
      const currentScale = camera.parallelScale
      const newScale = currentScale * delta
      
      viewportRef.current.setCamera({
        parallelScale: newScale
      })
      viewportRef.current.render()
      
      // Calculate zoom percentage based on a reasonable scale range
      // Assuming scale around 100-200 is "normal" zoom
      const baseScale = 150 // This seems to be around the "normal" scale value
      const zoomPercentage = (baseScale / newScale) * 100
      const zoomDecimal = Math.max(0.01, Math.min(10, zoomPercentage / 100)) // Clamp between 1% and 1000%
      
      lastAppliedZoomRef.current = zoomDecimal
      onZoomChange(zoomDecimal, false) // false means this is not from sync
      
      console.log(`Zoom: ${(zoomDecimal * 100).toFixed(0)}% (scale: ${newScale.toFixed(2)})`)
      
    } catch (error) {
      console.warn('Viewer zoom error:', error)
    }
  }, [onZoomChange, isInitialized])

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
        console.log('Tools added successfully')
        
        // Small delay to ensure tools are properly registered
        await new Promise(resolve => setTimeout(resolve, 50))
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
            ],
          })

          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [
              {
                mouseButton: csToolsEnums.MouseBindings.Primary, // Left Click
              },
            ],
          })
          
          console.log(`ToolGroup created successfully for viewer ${id}`)
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
        console.log(`Viewer ${id} initialized successfully`)
      }, 50) // Reduced delay for faster initialization
    }

    setup()

    return () => {
      // Cleanup
      try {
        setIsInitialized(false)
        eventListenerAdded.current = false
        if (elementRef.current) {
          elementRef.current.removeEventListener('wheel', handleWheel)
        }
        if (renderingEngineRef.current) {
          renderingEngineRef.current.destroy()
          renderingEngineRef.current = null
        }
        viewportRef.current = null
        runningRef.current = false
      } catch (error) {
        console.warn('Cleanup error:', error)
      }
    }
  }, [id])

  // Add event listener when viewer is initialized
  useEffect(() => {
    if (isInitialized && elementRef.current && !eventListenerAdded.current) {
      elementRef.current.addEventListener('wheel', handleWheel)
      eventListenerAdded.current = true
      console.log(`Event listener added for viewer ${id}`)
    }
  }, [isInitialized, id]) // Removed handleWheel from dependencies

  // Apply zoom level changes from sync (external updates)
  useEffect(() => {
    if (!isInitialized || !viewportRef.current || !renderingEngineRef.current) {
      return
    }

    // Skip if this viewer is the sync master (to prevent applying its own changes back to itself)
    if (isSyncMaster) {
      return
    }

    // Skip if the zoom level hasn't actually changed
    if (Math.abs(zoomLevel - lastAppliedZoomRef.current) < 0.001) {
      return
    }

    // Apply the zoom level to the viewport
    try {
      isApplyingZoomRef.current = true
      
      const baseScale = 150
      const targetScale = baseScale / zoomLevel
      
      viewportRef.current.setCamera({
        parallelScale: targetScale
      })
      viewportRef.current.render()
      
      lastAppliedZoomRef.current = zoomLevel
      
      console.log(`Applied sync zoom to viewer ${id}: ${(zoomLevel * 100).toFixed(0)}% (scale: ${targetScale.toFixed(2)})`)
      
    } catch (error) {
      console.warn('Apply zoom error:', error)
    } finally {
      // Small delay before allowing new zoom operations
      setTimeout(() => {
        isApplyingZoomRef.current = false
      }, 10)
    }
  }, [zoomLevel, isInitialized, id, isSyncMaster])

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
        lastAppliedZoomRef.current = 1
        onZoomChange(1, false)
        
        console.log(`Reset zoom for viewer ${id} to 100% (scale: ${baseScale.toFixed(2)})`)
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