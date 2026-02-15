# SoloSway MVP - Intelligent Property Appraisal Platform

A comprehensive web application designed to revolutionize property appraisal workflows through intelligent document processing, AI-powered data extraction, and advanced property analytics.

## 🚀 Features

### Core Platform
- **🔐 Secure Authentication**: User and business-level accounts with role-based access
- **📁 File Management**: Secure document upload and management via AWS S3
- **🗺️ Interactive Property Map**: Real-time property visualization with Mapbox integration
- **📊 Analytics Dashboard**: Comprehensive property and document analytics
- **💬 AI Chat Interface**: Intelligent property analysis and insights

### Intelligent Data Pipeline
- **📄 Document Processing**: Asynchronous processing of valuation documents
- **🤖 AI-Powered Extraction**: 
  - LlamaParse for document parsing
  - LlamaExtract for structured data extraction
  - OpenAI-powered analysis
- **🏠 Property Intelligence**:
  - Automatic address geocoding
  - Property linking and deduplication
  - Comparable property analysis
- **🔍 Vector Search**: Semantic search capabilities with Supabase pgvector
- **🏢 Multi-tenancy**: Business-isolated data with `business_id` sandboxing

## 🛠️ Tech Stack

### Backend
- **Framework**: Flask (Python 3.11)
- **Database**: PostgreSQL + Supabase (Document Storage & Vector)
- **Task Queue**: Celery with Redis
- **File Storage**: AWS S3 with API Gateway
- **AI Services**: LlamaCloud, OpenAI, LlamaIndex

### Frontend
- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **Maps**: Mapbox GL JS
- **Build Tool**: Vite
- **State Management**: React Context + Hooks

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Development**: Hot reload, TypeScript strict mode
- **Deployment**: Production-ready container setup

## 📁 Project Structure

├── backend/ # Flask API server
│ ├── services/ # Business logic services
│ ├── models.py # Database models
│ ├── views.py # API endpoints
│ ├── tasks.py # Celery background tasks
│ └── auth.py # Authentication logic
├── frontend-ts/ # TypeScript React frontend
│ ├── src/
│ │ ├── components/ # React components
│ │ ├── services/ # API service layer
│ │ ├── config/ # Environment configuration
│ │ └── hooks/ # Custom React hooks
│ ├── package.json # Frontend dependencies
│ └── vite.config.ts # Vite configuration
├── migrations/ # Database migrations
├── docker-compose.yaml # Container orchestration
└── requirements.txt # Python dependencies

## 🚀 Getting Started

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) and Docker Compose
- [Python 3.11](https://www.python.org/downloads/release/python-3110/)
- [Node.js 18+](https://nodejs.org/) (for frontend development)
- AWS account with S3 bucket and API Gateway
- API keys for LlamaCloud, OpenAI, and Supabase

### 1. Clone the Repository

```bash
git clone https://github.com/Rene-Niskanen/solosway_v1
cd solosway_mvp
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python3.11 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory
cd frontend-ts

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local
```

### 4. Environment Configuration

Create a `.env` file in the root directory:

```env
# Flask Configuration
SECRET_KEY='your-secret-key-here'
DATABASE_URL='postgresql://user:password@localhost/database_name'
REDIS_URL='redis://localhost:6379/0'

# AWS Configuration
AWS_ACCESS_KEY_ID='your-aws-access-key'
AWS_SECRET_ACCESS_KEY='your-aws-secret-key'
AWS_REGION='us-east-1'
S3_UPLOAD_BUCKET='your-s3-bucket-name'
API_GATEWAY_INVOKE_URL='https://yourapi.execute-api.region.amazonaws.com/stage'

# AI Services
LLAMA_CLOUD_API_KEY='llx-your-llama-key'
OPENAI_API_KEY='sk-your-openai-key'

# Supabase Configuration (replaces AstraDB)
SUPABASE_URL='https://your-project.supabase.co'
SUPABASE_SERVICE_KEY='your-service-key'

# Google Maps (for geocoding)
GOOGLE_MAPS_API_KEY='your-google-maps-key'
```

Configure `frontend-ts/.env.local`:

```env
VITE_BACKEND_URL=http://localhost:5002
VITE_MAPBOX_TOKEN=your-mapbox-token
VITE_OPENAI_API_KEY=your-openai-key
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-key
```

### 5. Database Setup

```bash
# Initialize database
flask db init
flask db migrate -m "Initial migration"
flask db upgrade

# Create admin user (optional)
python make_admin.py
```

### 6. Running the Application

#### Option A: Full Docker Setup (Recommended)

```bash
# Start all services
docker-compose up --build -d

# View logs
docker-compose logs -f
```

#### Option B: Hybrid Development

```bash
# Terminal 1: Start Redis (required for upload processing)
docker compose up redis -d
# Or: docker-compose up redis -d

# Terminal 2: Start Flask API
python main.py

# Terminal 3: Start Celery worker (processes uploads in the background)
python run_celery_worker.py

# Terminal 4: Start frontend
cd frontend-ts
npm run dev
```

#### Document uploads: Redis + Flask + Celery

For **document uploads and processing** to work, three things must be running:

| Service    | Purpose |
|-----------|---------|
| **Redis** | Celery broker – tasks are queued here |
| **Flask** | API – accepts uploads and enqueues processing |
| **Celery worker** | Runs the processing pipeline (classification, extraction, etc.) |

**Quick start (script):**

```bash
./scripts/start-for-uploads.sh
```

Then in **two separate terminals** run:

```bash
# Terminal 1 – Flask (API on port 5001)
python main.py

# Terminal 2 – Celery worker (must be running for upload processing)
python run_celery_worker.py
```

**Or run everything with Docker:**

```bash
docker compose up redis web worker -d
```

- API: http://localhost:5002 (Flask in Docker maps 5002→5000)
- Ensure frontend `VITE_BACKEND_URL` matches (e.g. `http://localhost:5001` for local Flask or `http://localhost:5002` for Docker).

### 7. Access the Application

- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:5002
- **Admin Panel**: http://localhost:5002/admin (if admin user created)

## 📖 API Documentation

### Authentication Endpoints
- `POST /api/login` - User login
- `POST /api/signup` - User registration
- `GET /api/dashboard` - Get user dashboard data

### Document Management
- `POST /api/upload-file` - Upload document
- `GET /api/files` - List user documents
- `DELETE /api/files/{id}` - Delete document

### Property Analysis
- `GET /api/properties` - Get all properties
- `POST /api/properties/search` - Search properties
- `POST /api/properties/{id}/comparables` - Get property comparables

### AI Services
- `POST /api/llm/analyze-query` - Analyze user query
- `POST /api/llm/chat` - AI chat completion
- `POST /api/ocr/extract` - Extract text from images

## 🧪 Development

### Running Tests

```bash
# Backend tests
python -m pytest tests/

# Frontend tests
cd frontend-ts
npm test
```

### Code Quality

```bash
# Backend linting
flake8 backend/
black backend/

# Frontend linting
cd frontend-ts
npm run lint
npm run type-check
```

### Database Migrations

```bash
# Create migration
flask db migrate -m "Description of changes"

# Apply migration
flask db upgrade
```

## 🚀 Deployment

### Production Environment Variables

Ensure all production secrets are set:
- Database connection strings
- AWS credentials
- API keys
- CORS origins

### Docker Production Build

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

## 📊 Data Pipeline

The application processes documents through a sophisticated pipeline:

1. **Upload**: Documents uploaded to S3 via secure API Gateway
2. **Parse**: LlamaParse extracts text and structure
3. **Extract**: LlamaExtract identifies properties and attributes
4. **Geocode**: Google Maps API provides location data
5. **Store**: Data stored in Supabase (document storage + vector)
6. **Index**: Vector embeddings enable semantic search

## 🔧 Troubleshooting

### Common Issues

**Frontend not connecting to backend:**
- Check `VITE_BACKEND_URL` in `.env.local`
- Verify backend is running on correct port
- Check CORS configuration in `backend/config.py`

**Document processing failing:**
- Verify all API keys are valid
- Check Celery worker logs: `docker-compose logs worker`
- Ensure Supabase credentials are correct

**Database connection issues:**
- Verify PostgreSQL is running
- Check connection string format
- Run migrations: `flask db upgrade`

### Logs and Debugging

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f web
docker-compose logs -f worker

# Debug frontend
cd frontend-ts
npm run dev -- --debug
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a Pull Request

## 📄 License

This project is proprietary software. All rights reserved.
