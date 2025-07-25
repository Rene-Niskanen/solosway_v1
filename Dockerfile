FROM python:3.11-slim

WORKDIR /app

# Upgrade pip to the latest version to ensure compatibility with modern packages
RUN pip install --upgrade pip

COPY requirements.txt .
RUN pip install --default-timeout=100 --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_APP=main.py

EXPOSE 5000

CMD ["flask", "run", "--host=0.0.0.0"] 