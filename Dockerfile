FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including PostgreSQL client
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip to the latest version to ensure compatibility with modern packages
RUN pip install --upgrade pip

COPY requirements.txt .
RUN pip install --default-timeout=100 --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_APP=main.py

EXPOSE 5000

# Create a startup script that runs migrations and starts Flask
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"] 