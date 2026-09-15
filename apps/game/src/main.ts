const app = document.getElementById('app')

if (app) {
  const canvas = document.createElement('canvas')
  canvas.id = 'game-canvas'
  app.appendChild(canvas)
  canvas.dataset.bootState = 'scaffold'
}

document.title = 'VoxelCraft'
console.info('[voxelcraft] scaffold boot ok')

export {}
