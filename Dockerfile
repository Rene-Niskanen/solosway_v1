FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including PostgreSQL client
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip to the latest version to ensure compatibility with modern packages
RUN pip install --upgrade pip

# Copy only requirements first (better layer caching)
COPY requirements.txt .
RUN pip install --default-timeout=100 --no-cache-dir -r requirements.txt

# Copy only necessary application files (excludes node_modules, docs, etc. via .dockerignore)
COPY backend/ ./backend/
COPY main.py .
COPY run_celery_worker.py .
COPY start.sh ./start.sh

ENV FLASK_APP=main.py

EXPOSE 5000

# Make startup script executable and ensure proper line endings
RUN chmod +x /app/start.sh && \
    sed -i 's/\r$//' /app/start.sh || true

# Use bash explicitly to ensure the script runs properly
CMD ["/bin/bash", "/app/start.sh"] 