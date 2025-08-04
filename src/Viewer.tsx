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
  onZoomChange: (zoomLevel: number) => void
  syncZoom: boolean
  onSyncToggle: (syncZoom: boolean) => void
  globalZoomLevel?: number
  onRemove: () => void
}

export default function Viewer({ 
  id, 
  zoomLevel, 
  onZoomChange, 
  syncZoom, 
  onSyncToggle, 
  globalZoomLevel,
  onRemove 
}: ViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const runningRef = useRef(false) // Unique ref for each viewer
  const viewportRef = useRef<Types.IStackViewport | null>(null)
  const renderingEngineRef = useRef<RenderingEngine | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Define handleWheel at component scope so it can be referenced in cleanup
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    
    // Only proceed if viewer is fully initialized
    if (!isInitialized || !viewportRef.current || !renderingEngineRef.current) {
      return
    }
    
    const delta = e.deltaY > 0 ? 0.95 : 1.05
    const newZoomLevel = zoomLevel * delta
    onZoomChange(newZoomLevel)
    
    try {
      const camera = viewportRef.current.getCamera()
      viewportRef.current.setCamera({
        parallelScale: camera.parallelScale * delta
      })
      viewportRef.current.render()
    } catch (error) {
      console.warn('Viewer zoom error:', error)
    }
  }, [zoomLevel, onZoomChange, isInitialized])

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
    if (isInitialized && elementRef.current) {
      elementRef.current.addEventListener('wheel', handleWheel)
      console.log(`Event listener added for viewer ${id}`)
    }
  }, [isInitialized, handleWheel, id])

  // Handle global zoom sync
  useEffect(() => {
    try {
      if (syncZoom && globalZoomLevel && viewportRef.current && renderingEngineRef.current && isInitialized) {
        const camera = viewportRef.current.getCamera()
        const currentZoom = camera.parallelScale
        const targetZoom = globalZoomLevel
        
        if (Math.abs(currentZoom - targetZoom) > 0.01) {
          viewportRef.current.setCamera({
            parallelScale: targetZoom
          })
          viewportRef.current.render()
        }
      }
    } catch (error) {
      console.warn('Global zoom sync error:', error)
    }
  }, [syncZoom, globalZoomLevel, isInitialized])

  const resetZoom = () => {
    try {
      if (viewportRef.current && renderingEngineRef.current && isInitialized) {
        const camera = viewportRef.current.getCamera()
        const baseScale = camera.parallelScale / zoomLevel
        viewportRef.current.setCamera({
          parallelScale: baseScale
        })
        viewportRef.current.render()
        onZoomChange(1)
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
          Sync Zoom
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