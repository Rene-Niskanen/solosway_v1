#!/bin/bash

echo "🚀 Starting SoloSway application..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
while ! pg_isready -h postgres -p 5432 -U solosway_user; do
  echo "PostgreSQL is not ready yet, waiting..."
  sleep 2
done

echo "✅ PostgreSQL is ready!"

# Set up the database
echo "🗄️ Setting up database..."
export FLASK_APP=main.py

# Initialize database if needed
echo "📋 Initializing database..."
flask db init || echo "Database already initialized"

# Run migrations
echo "🔄 Running database migrations..."
flask db migrate -m "Initial migration" || echo "Migration already exists"

# Try to upgrade, but continue if there are errors
echo "🔄 Upgrading database..."
if flask db upgrade; then
    echo "✅ Database upgrade successful!"
else
    echo "⚠️ Database upgrade had issues, but continuing..."
fi

echo "✅ Database setup complete!"

# Start the Flask application
echo "🌐 Starting Flask application..."
exec flask run --host=0.0.0.0 --port=5000
