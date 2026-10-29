/**
 * Copy server files for unified build
 * This script copies the server directory into the Electron app resources
 */

const fs = require('fs-extra');
const path = require('path');

const serverSource = path.join(__dirname, '..', '..', 'server');
const serverDest = path.join(__dirname, '..', 'server');

async function copyServer() {
  console.log('Copying server files for unified build...');

  try {
    // Remove existing server copy if present
    if (await fs.pathExists(serverDest)) {
      await fs.remove(serverDest);
    }

    // Copy server directory
    await fs.copy(serverSource, serverDest, {
      filter: (src) => {
        // Exclude node_modules, .git, etc.
        const relativePath = path.relative(serverSource, src);
        if (relativePath.includes('node_modules')) return false;
        if (relativePath.includes('.git')) return false;
        if (relativePath.endsWith('.log')) return false;
        return true;
      }
    });

    // Copy package.json from root for dependencies
    const rootPackage = path.join(__dirname, '..', '..', 'package.json');
    const serverPackage = path.join(serverDest, 'package.json');

    const pkg = await fs.readJson(rootPackage);
    await fs.writeJson(serverPackage, {
      name: 'emberlan-server',
      version: pkg.version,
      main: 'index.js',
      dependencies: pkg.dependencies
    }, { spaces: 2 });

    console.log('Server files copied successfully!');
    console.log(`Source: ${serverSource}`);
    console.log(`Destination: ${serverDest}`);

  } catch (error) {
    console.error('Failed to copy server:', error);
    process.exit(1);
  }
}

copyServer();
