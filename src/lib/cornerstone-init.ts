import { init as csRenderInit } from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

export async function initializeCornerstone() {
  await csRenderInit();
  await csToolsInit();
  dicomImageLoaderInit({ maxWebWorkers: 1 });
}