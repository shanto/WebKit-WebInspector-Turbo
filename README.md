# WebKit-WebInspector-Turbo

A streamlined toolkit for running WebKit iOS Inspector with ios_webkit_debug_proxy.

https://github.com/user-attachments/assets/737b3fa3-9484-4e86-bb78-95d24d8277df

## Overview

This project provides an optimized environment for debugging iOS Safari web content using WebKit's Web Inspector, powered by Google's ios_webkit_debug_proxy. It bundles and optimizes the WebKit inspector UI for better performance.

## Prerequisites

- Git
- Node.js
- ios_webkit_debug_proxy (must be installed and available in PATH)

## Quick Start

1. Clone this repository
2. Run the bootstrap script:
   ```
   .\bootstrap.ps1
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Build the optimized inspector:
   ```
   node build.js
   ```
5. Start the server:
   ```
   node server.js
   ```
6. Connect your iOS device via USB and navigate to:
   ```
   http://localhost:9221/
   ```

## How It Works

- `bootstrap.ps1`: Sets up the required WebKit source files using sparse checkout
- `build.js`: Bundles and optimizes the WebKit Inspector UI using esbuild
- `server.js`: Serves the optimized inspector and launches ios_webkit_debug_proxy

## Features

- Optimized bundle size with minified JS/CSS
- Automatic proxy configuration
- Sparse checkout of only necessary WebKit files
- Multi-process server for improved performance

## License

This project uses components from WebKit and ios_webkit_debug_proxy, each under their respective licenses.
