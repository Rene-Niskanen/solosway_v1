#!/bin/bash

echo "🚀 Starting SoloSway application..."

# Note: Database is managed by Supabase - no Flask migrations needed
# Flask-Migrate commands have been removed since we're using Supabase schema management

# Start the Flask application directly
echo "🌐 Starting Flask application..."
exec flask run --host=0.0.0.0 --port=5000
