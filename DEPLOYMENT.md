# Railway Deployment Guide

## Prerequisites
- GitHub repository with your code
- Railway account

## Step 1: Prepare Your Repository

Your repository is now ready with:
- ✅ `config.py` - Handles both SQLite (development) and PostgreSQL (production)
- ✅ Updated `__init__.py` - Uses the new config system
- ✅ `requirements.txt` - Includes `psycopg2-binary` for PostgreSQL

## Step 2: Deploy to Railway

1. **Connect Repository**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

2. **Add PostgreSQL Database**
   - In your Railway project dashboard
   - Click "New" → "Database" → "PostgreSQL"
   - Wait for provisioning

3. **Configure Environment Variables**
   - In your Railway project settings
   - Add these environment variables:
     ```
     FLASK_ENV=production
     DATABASE_URL=<Railway will provide this automatically>
     SECRET_KEY=<your-secret-key>
     ```

4. **Deploy**
   - Railway will automatically deploy your app
   - The database tables will be created automatically

## Step 3: Verify Deployment

1. **Check Logs**
   - In Railway dashboard, check the deployment logs
   - Look for "Database tables ensured!" message

2. **Test Your App**
   - Visit your Railway app URL
   - Test login/registration functionality

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `FLASK_ENV` | Set to `production` for Railway | Yes |
| `DATABASE_URL` | PostgreSQL connection string (auto-provided) | Yes |
| `SECRET_KEY` | Flask secret key for sessions | Yes |

## Local Development

For local development, your app will automatically use SQLite:
```bash
# No environment variables needed for local development
python main.py
```

## Migration from SQLite to PostgreSQL

If you have existing data in SQLite that you want to migrate:

1. **Export SQLite Data**
   ```bash
   sqlite3 instance/database.db .dump > backup.sql
   ```

2. **Import to PostgreSQL** (after Railway deployment)
   ```bash
   # Use Railway's PostgreSQL connection string
   psql <DATABASE_URL> < backup.sql
   ```

## Troubleshooting

- **Database Connection Issues**: Check that `DATABASE_URL` is set correctly
- **Import Errors**: Ensure `psycopg2-binary` is in `requirements.txt`
- **CORS Issues**: Update `CORS_ORIGINS` in `config.py` with your frontend domain 