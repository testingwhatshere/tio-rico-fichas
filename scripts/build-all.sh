#!/bin/bash

# Build All Apps - Game Automation Platform
# Creates deliverables folder with all compiled apps

set -e  # Exit on error

echo "🚀 Starting build process for all apps..."

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DELIVERABLES_DIR="$PROJECT_ROOT/deliverables"
BUILD_DATE=$(date +%Y%m%d-%H%M%S)

# Clean and create deliverables directory
echo "📁 Creating deliverables directory..."
rm -rf "$DELIVERABLES_DIR"
mkdir -p "$DELIVERABLES_DIR"

# Create subdirectories
mkdir -p "$DELIVERABLES_DIR/backend-api"
mkdir -p "$DELIVERABLES_DIR/chat-app"
mkdir -p "$DELIVERABLES_DIR/validator-app"
mkdir -p "$DELIVERABLES_DIR/operator-panel"
mkdir -p "$DELIVERABLES_DIR/automation-extension"

# Build Backend API
echo ""
echo "🔧 Building Backend API..."
cd "$PROJECT_ROOT/apps/backend-api"
echo "   Installing dependencies..."
bun install
echo "   Building..."
bun run build
cp -r dist/* "$DELIVERABLES_DIR/backend-api/"
cp package.json "$DELIVERABLES_DIR/backend-api/"
cp -r prisma "$DELIVERABLES_DIR/backend-api/"
echo "✅ Backend API built successfully"

# Build Validator App (Electron) - Windows
echo ""
echo "🔧 Building Validator App for Windows..."
cd "$PROJECT_ROOT/apps/validator-app"
echo "   Installing dependencies..."
npm install
echo "   Building for Windows..."
npm run build:win
if [ -d "dist" ]; then
    cp -r dist/* "$DELIVERABLES_DIR/validator-app/"
fi
echo "✅ Validator App built successfully"

# Build Operator Panel (Electron) - Windows
echo ""
echo "🔧 Building Operator Panel for Windows..."
cd "$PROJECT_ROOT/apps/operator-panel"
echo "   Installing dependencies..."
npm install
echo "   Building for Windows..."
npm run build:win
if [ -d "dist" ]; then
    cp -r dist/* "$DELIVERABLES_DIR/operator-panel/"
fi
echo "✅ Operator Panel built successfully"

# Package Automation Extension
echo ""
echo "🔧 Packaging Automation Extension..."
cd "$PROJECT_ROOT/apps/automation-extension"
# Create a clean zip without node_modules and dev files
zip -r "$DELIVERABLES_DIR/automation-extension/chrome-extension.zip" . \
    -x '*.git*' \
    -x 'node_modules/*' \
    -x 'package.json' \
    -x 'package-lock.json' \
    -x 'bun.lockb' \
    -x '.DS_Store'
echo "✅ Automation Extension packaged successfully"

# Export Chat App (Expo)
echo ""
echo "🔧 Exporting Chat App..."
cd "$PROJECT_ROOT/apps/chat-app"
echo "   Installing dependencies..."
bun install

# Export for web
echo "   Exporting for web..."
npx expo export --platform web --output-dir "$DELIVERABLES_DIR/chat-app/web"

# Note: For iOS/Android builds, you'd typically use EAS Build
echo "   Note: For iOS/Android builds, use 'eas build' command separately"
echo "   Web version exported to deliverables/chat-app/web"
echo "✅ Chat App exported successfully"

# Create README
echo ""
echo "📝 Creating README..."
cat > "$DELIVERABLES_DIR/README.md" << 'EOF'
# Game Automation Platform - Deliverables

Build Date: BUILD_DATE_PLACEHOLDER
Build OS: PLATFORM_PLACEHOLDER
Target Platform: Windows (Electron apps)

## Contents

### 1. Backend API (`backend-api/`)
- NestJS application (compiled)
- Run with: `node dist/src/main.js`
- Requires: PostgreSQL, Redis
- Configure via environment variables

### 2. Chat App (`chat-app/`)
- **Web version**: Ready to deploy (`chat-app/web/`)
- **Mobile builds**: Use Expo EAS Build for iOS/Android
  - iOS: `cd apps/chat-app && eas build --platform ios`
  - Android: `cd apps/chat-app && eas build --platform android`

### 3. Validator App (`validator-app/`)
- Electron desktop application for Windows
- Windows installer (.exe) included
- Install and run the executable on Windows 10+

### 4. Operator Panel (`operator-panel/`)
- Electron desktop application for Windows
- Windows installer (.exe) included
- Install and run the executable on Windows 10+

### 5. Automation Extension (`automation-extension/`)
- Chrome extension (chrome-extension.zip)
- Installation:
  1. Unzip the file
  2. Open Chrome: chrome://extensions
  3. Enable "Developer mode"
  4. Click "Load unpacked"
  5. Select the unzipped folder
  6. Configure via extension options page

## Deployment Checklist

- [ ] Deploy Backend API to server/VPS
- [ ] Configure PostgreSQL database
- [ ] Configure Redis instance
- [ ] Set up environment variables
- [ ] Run database migrations: `npx prisma migrate deploy`
- [ ] Deploy web chat to hosting (Vercel/Netlify)
- [ ] Distribute Validator App to operators
- [ ] Distribute Operator Panel to operators
- [ ] Install Chrome extension on automation machine
- [ ] Configure extension with backend URL & credentials
- [ ] Test end-to-end flow

## Platform Requirements

### Backend API
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Validator App
- Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)

### Operator Panel
- Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)

### Automation Extension
- Chrome browser (latest version)
- Persistent Chrome session on dedicated machine

### Chat App (Web)
- Modern web browser
- Deploy to static hosting (Vercel, Netlify, etc.)

### Chat App (Mobile)
- iOS: iPhone running iOS 13+
- Android: Android 6.0+

## Support

For issues or questions, refer to the project documentation.
EOF

# Replace placeholders
sed -i.bak "s/BUILD_DATE_PLACEHOLDER/$BUILD_DATE/g" "$DELIVERABLES_DIR/README.md"
sed -i.bak "s/PLATFORM_PLACEHOLDER/$OSTYPE/g" "$DELIVERABLES_DIR/README.md"
rm "$DELIVERABLES_DIR/README.md.bak"

# Create deployment guide
cat > "$DELIVERABLES_DIR/DEPLOYMENT.md" << 'EOF'
# Deployment Guide

## Quick Start

### 1. Backend API

```bash
cd deliverables/backend-api

# Install production dependencies
npm install --production

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npx prisma migrate deploy

# Start the server
node dist/src/main.js
```

### 2. Chat App (Web)

```bash
cd deliverables/chat-app/web

# Deploy to Vercel
vercel deploy

# Or deploy to Netlify
netlify deploy

# Or serve with any static hosting
```

### 3. Validator App

1. Locate the installer in `deliverables/validator-app/`
2. Run the installer (`.dmg` for macOS, `.exe` for Windows, `.AppImage` for Linux)
3. Launch the application
4. Configure backend URL in settings

### 4. Operator Panel

1. Locate the installer in `deliverables/operator-panel/`
2. Run the installer (`.dmg` for macOS, `.exe` for Windows, `.AppImage` for Linux)
3. Launch the application
4. Login with operator credentials

### 5. Automation Extension

1. Unzip `deliverables/automation-extension/chrome-extension.zip`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the unzipped extension folder
6. Click the extension icon and configure:
   - Backend API URL
   - API Key
   - Panel credentials
7. Test connection

## Production Considerations

### Security
- Use HTTPS for all web endpoints
- Rotate API keys regularly
- Use strong JWT secrets
- Enable rate limiting
- Configure CORS properly

### Monitoring
- Set up health checks for backend
- Monitor queue processing
- Track failed jobs
- Set up alerts for errors

### Scaling
- Use managed PostgreSQL (AWS RDS, DigitalOcean, etc.)
- Use managed Redis (AWS ElastiCache, Redis Cloud, etc.)
- Consider load balancing for backend
- Use CDN for chat app static files

### Backup
- Daily database backups
- Store screenshots and logs
- Backup configuration files

## Environment Variables (Backend)

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Redis
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""

# JWT
JWT_SECRET="your-super-secret-key-change-this"
JWT_EXPIRES_IN="7d"

# API
PORT=3000
NODE_ENV="production"

# Bot
BOT_API_KEY="secure-bot-key"

# Security
MAX_REQUEST_AMOUNT=1000
RATE_LIMIT_MAX=100
```

## Troubleshooting

### Backend won't start
- Check DATABASE_URL is correct
- Ensure PostgreSQL is running
- Verify Redis connection
- Check port availability

### Extension not connecting
- Verify backend URL is correct
- Check API key matches
- Ensure CORS is configured
- Check network/firewall

### Chat app errors
- Verify backend URL in app config
- Check Socket.IO connection
- Inspect browser console

### Electron apps won't launch
- Check system requirements
- Verify installation completed
- Check permissions (macOS)
- Review application logs
EOF

# Create build info file
cat > "$DELIVERABLES_DIR/BUILD_INFO.txt" << EOF
Build Information
=================

Date: $BUILD_DATE
Platform: $OSTYPE
Project: Game Automation Platform

Components Built:
- Backend API (NestJS)
- Chat App (Expo - Web export)
- Validator App (Electron)
- Operator Panel (Electron)
- Automation Extension (Chrome Extension)

Build Script: scripts/build-all.sh

Notes:
- Mobile builds (iOS/Android) require EAS Build
- Electron apps built for current platform only
- Backend requires node_modules installation in production
EOF

# Summary
echo ""
echo "✨ Build completed successfully!"
echo ""
echo "📦 Deliverables created in: $DELIVERABLES_DIR"
echo ""
echo "Contents:"
echo "  - backend-api/          (NestJS compiled)"
echo "  - chat-app/web/         (Expo web export)"
echo "  - validator-app/        (Electron installer)"
echo "  - operator-panel/       (Electron installer)"
echo "  - automation-extension/ (Chrome extension zip)"
echo "  - README.md"
echo "  - DEPLOYMENT.md"
echo "  - BUILD_INFO.txt"
echo ""
echo "Next steps:"
echo "  1. Review the README.md in deliverables/"
echo "  2. Follow DEPLOYMENT.md for deployment instructions"
echo "  3. For mobile builds, run 'eas build' separately"
echo ""
