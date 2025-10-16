#!/bin/bash

# Cleanup script for removing unnecessary files from production frontend
# Run this script to remove all files that are now in .gitignore

echo "🧹 Cleaning up unnecessary files for production..."

# Remove documentation files (keep README.md)
echo "📚 Removing documentation files..."
rm -f FILE_MANAGEMENT_GUIDE.md
rm -f PROPERTY_DATABASE_INFO.md
rm -f HOW_TO_SHOW_MAP.md
rm -f MAPBOX_DEBUG_GUIDE.md
rm -f BACKEND_INTEGRATION.md
rm -f SECURITY_FIXES_SUMMARY.md
rm -f ENV_SETUP.md
rm -f OPENAI_SETUP.md
rm -f src/llm/README.md
rm -f src/components/IMAGE_UPLOAD_README.md

# Remove unused/development components
echo "🗑️  Removing unused components..."
rm -f src/components/ImageUploadTest.tsx
rm -f src/components/SquareMap.tsx.backup
rm -f src/components/SearchBarWithImageUpload.tsx
rm -f src/utils/envTest.ts
rm -f src/utils/mapboxDiagnostic.ts

# Remove lock files (keep only one - keeping package-lock.json)
echo "🔒 Cleaning up lock files..."
rm -f yarn.lock
rm -f pnpm-lock.yaml
rm -f bun.lockb

echo "✅ Cleanup complete! The following files have been removed:"
echo "   - All documentation files (except README.md)"
echo "   - Unused test components"
echo "   - Backup files"
echo "   - Development utilities"
echo "   - Extra lock files"
echo ""
echo "🚀 Your frontend is now production-ready!"
