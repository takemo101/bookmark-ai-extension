import React from 'react'
import { createRoot } from 'react-dom/client'

import { Popup } from './Popup'
import { createRuntimeUseCases } from './runtime'
import { createPopupController } from './view-model'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Popup root element #root not found')
}

// Composition root: build the real use cases, wrap them in the controller, and
// inject it. The component itself stays free of Chrome/Drive/AI wiring.
const controller = createPopupController(createRuntimeUseCases())

createRoot(container).render(
  <React.StrictMode>
    <Popup controller={controller} />
  </React.StrictMode>,
)
