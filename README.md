# SoloSway MVP - Intelligent Property Appraisal Platform

This is a project for the SoloSway Velora Platform, a web application designed to help property appraisers streamline their workflow by intelligently parsing valuation documents, extracting key data, and storing it for analysis and LLM interpretation.

The platform is built with a Python Flask backend, a Celery worker for asynchronous task processing, and a React frontend. It leverages a powerful data pipeline including LlamaParse for document analysis, LlamaExtract (via OpenAI) for structured data extraction, and AstraDB for both tabular and vector data storage.

## Features

- **Secure User Authentication:** User and business-level accounts.
- **File Upload & Management:** Securely upload and manage valuation documents via AWS S3.
- **Intelligent Data Pipeline:** Asynchronous processing of documents to:
    - Parse PDF content using LlamaParse.
    - Extract structured comparable property data using an OpenAI-powered extractor.
    - Store structured data in an AstraDB tabular collection.
    - Create and store vector embeddings of documents in an AstraDB vector store for future semantic search and RAG capabilities.
- **Multi-tenancy:** Data is sandboxed on a per-business basis using a `business_id`.

## Tech Stack

- **Backend:** Flask
- **Database:** PostgreSQL (for metadata), AstraDB (for tabular and vector data)
- **Task Queue:** Celery with Redis as the message broker
- **File Storage:** AWS S3 with API Gateway for secure access
- **AI / Data Processing:**
    - LlamaParse (LlamaCloud)
    - OpenAI API (for LlamaExtract)
    - LlamaIndex
- **Containerization:** Docker & Docker Compose

---

## Getting Started

Follow these instructions to get the application running locally for development.

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) and Docker Compose
- [Python 3.11](https://www.python.org/downloads/release/python-3110/) (It's recommended to manage Python versions with `pyenv`)
- An active AWS account with an S3 bucket and API Gateway configured.
- API keys for LlamaCloud, OpenAI, and AstraDB.

### 1. Clone the Repository

```bash
git clone https://github.com/Rene-Niskanen/solosway_v1
cd file_name
```

### 2. Set Up the Python Environment

It is highly recommended to use a virtual environment.

```bash
# Create a virtual environment
python3.11 -m venv .venv

# Activate it
source .venv/bin/activate

# Install the required dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file in the root of the project. This file stores all your secret keys and configuration variables. **Do not commit this file to source control.**

Copy the following example and replace the placeholder values with your actual credentials.

```env
# Flask and Local Database
SECRET_KEY='a_very_secret_and_long_random_string'
DATABASE_URL='postgresql://user:password@localhost/database_name' # Your local PostgreSQL connection string
REDIS_URL='redis://localhost:6379/0'
ADMIN_EMAIL='your_admin_email@example.com' # Used by the make_admin.py script

# AWS S3 & API Gateway
# Ensure your API Gateway endpoint for uploads is configured correctly
AWS_ACCESS_KEY_ID='YOUR_AWS_ACCESS_KEY'
AWS_SECRET_ACCESS_KEY='YOUR_AWS_SECRET_KEY'
AWS_REGION='us-east-1' # e.g., us-east-1
S3_UPLOAD_BUCKET='your-s3-bucket-name'
API_GATEWAY_INVOKE_URL='https://yourapi.execute-api.your-region.amazonaws.com/your-stage'

# LlamaIndex / LlamaCloud
# Your API key for the LlamaParse service
LLAMA_CLOUD_API_KEY='llx-...'

# OpenAI
# Your API key for accessing models like GPT-4 for data extraction
OPENAI_API_KEY='sk-...'

# AstraDB (DataStax)
# All these credentials come from a single Vector Database instance on Astra
ASTRA_DB_API_ENDPOINT='https://<db-id>-<db-region>.apps.astra.datastax.com'
ASTRA_DB_APPLICATION_TOKEN='AstraCS:...'
# NOTE: The secure connect bundle path should be the path *inside the container* if you
# plan to use it directly. For now, we are connecting via the API endpoint.
# ASTRA_DB_SECURE_CONNECT_BUNDLE_PATH="/path/to/your/secure-connect-bundle.zip" 
ASTRA_DB_KEYSPACE="your_keyspace_name" # e.g., solosway
ASTRA_DB_VECTOR_COLLECTION_NAME="property_appraisals_vectors"
ASTRA_DB_TABULAR_COLLECTION_NAME="property_appraisals_tabular"

```

### 4. Running the Application with Docker

The easiest way to run the entire stack (Flask web server, Redis, and the Celery worker) is with Docker Compose.

```bash
# Build and start the services in the background
docker-compose up --build -d
```

- The Flask application will be available at `http://localhost:5001`.
- The React frontend (if running separately) should be configured to proxy API requests to this address.
- The Celery worker will automatically start and begin watching for tasks.

To view the logs from all services:
```bash
docker-compose logs -f
```

To view logs for a specific service (e.g., the worker):
```bash
docker-compose logs -f worker
```

### 5. Stopping the Application

To stop all running containers:
```bash
docker-compose down
```

---

## Database Migrations

This project uses Flask-Migrate to handle database schema changes.

To initialize the database for the first time:
```bash
# Make sure your Docker container is running so the DB is accessible
flask db init 
flask db migrate -m "Initial migration."
flask db upgrade
```

To create a new migration after changing the models in `website/models.py`:
```bash
flask db migrate -m "A short description of the changes."
flask db upgrade
```

## Making a User an Admin

A script is provided to grant a user admin privileges.
1.  Ensure the user has already registered through the application.
2.  Make sure the `ADMIN_EMAIL` in your `.env` file is set to the email of the user you want to promote.
3.  Run the script:
    ```bash
    python make_admin.py
    ```
