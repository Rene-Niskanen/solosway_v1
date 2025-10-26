"""
Health Check Service
Monitors system health and provides detailed health status
"""
import time
import logging
import os
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import requests
from supabase import create_client

# Try to import optional dependencies
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logging.warning("psutil not available - system resource monitoring will be limited")

logger = logging.getLogger(__name__)

class HealthCheckService:
    """Service for monitoring system health"""
    
    def __init__(self):
        self.start_time = time.time()
        self.last_checks = {}
        self.check_cache_duration = 30  # Cache health checks for 30 seconds
    
    def check_database_health(self) -> Dict[str, Any]:
        """Check database connectivity and performance"""
        try:
            # Check Supabase connection
            supabase_url = os.environ.get('SUPABASE_URL')
            supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
            
            if not supabase_url or not supabase_key:
                return {
                    'status': 'unhealthy',
                    'error': 'Supabase credentials not configured',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Test connection with a simple query
            start_time = time.time()
            supabase = create_client(supabase_url, supabase_key)
            
            # Simple query to test connection
            result = supabase.table('properties').select('id').limit(1).execute()
            
            response_time = time.time() - start_time
            
            return {
                'status': 'healthy',
                'response_time_ms': round(response_time * 1000, 2),
                'connection_test': 'passed',
                'timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Database health check failed: {str(e)}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def check_supabase_health(self) -> Dict[str, Any]:
        """Check Supabase service health"""
        try:
            supabase_url = os.environ.get('SUPABASE_URL')
            if not supabase_url:
                return {
                    'status': 'unhealthy',
                    'error': 'Supabase URL not configured',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Check Supabase API health
            health_url = f"{supabase_url.replace('/rest/v1', '')}/health"
            
            start_time = time.time()
            response = requests.get(health_url, timeout=5)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                return {
                    'status': 'healthy',
                    'response_time_ms': round(response_time * 1000, 2),
                    'api_status': 'available',
                    'timestamp': datetime.utcnow().isoformat()
                }
            else:
                return {
                    'status': 'unhealthy',
                    'error': f'API returned status {response.status_code}',
                    'timestamp': datetime.utcnow().isoformat()
                }
                
        except Exception as e:
            logger.error(f"Supabase health check failed: {str(e)}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def check_external_services_health(self) -> Dict[str, Any]:
        """Check external services health"""
        services = {}
        
        # Check LlamaCloud API
        services['llamacloud'] = self._check_llamacloud_health()
        
        # Check Google Maps API (if configured)
        services['google_maps'] = self._check_google_maps_health()
        
        # Check AWS S3 (if configured)
        services['aws_s3'] = self._check_aws_s3_health()
        
        # Overall status
        all_healthy = all(service['status'] == 'healthy' for service in services.values())
        
        return {
            'status': 'healthy' if all_healthy else 'degraded',
            'services': services,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _check_llamacloud_health(self) -> Dict[str, Any]:
        """Check LlamaCloud API health"""
        try:
            api_key = os.environ.get('LLAMA_CLOUD_API_KEY')
            if not api_key:
                return {
                    'status': 'unhealthy',
                    'error': 'API key not configured',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Test API accessibility
            headers = {'Authorization': f'Bearer {api_key}'}
            start_time = time.time()
            
            response = requests.get(
                'https://api.cloud.llamaindex.ai/api/v1/health',
                headers=headers,
                timeout=10
            )
            
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                return {
                    'status': 'healthy',
                    'response_time_ms': round(response_time * 1000, 2),
                    'timestamp': datetime.utcnow().isoformat()
                }
            else:
                return {
                    'status': 'unhealthy',
                    'error': f'API returned status {response.status_code}',
                    'timestamp': datetime.utcnow().isoformat()
                }
                
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def _check_google_maps_health(self) -> Dict[str, Any]:
        """Check Google Maps API health"""
        try:
            api_key = os.environ.get('GOOGLE_MAPS_API_KEY')
            if not api_key:
                return {
                    'status': 'not_configured',
                    'message': 'Google Maps API key not configured',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Test geocoding API
            start_time = time.time()
            response = requests.get(
                'https://maps.googleapis.com/maps/api/geocode/json',
                params={
                    'address': 'London, UK',
                    'key': api_key
                },
                timeout=5
            )
            
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'OK':
                    return {
                        'status': 'healthy',
                        'response_time_ms': round(response_time * 1000, 2),
                        'timestamp': datetime.utcnow().isoformat()
                    }
                else:
                    return {
                        'status': 'unhealthy',
                        'error': f"API error: {data.get('status')}",
                        'timestamp': datetime.utcnow().isoformat()
                    }
            else:
                return {
                    'status': 'unhealthy',
                    'error': f'HTTP {response.status_code}',
                    'timestamp': datetime.utcnow().isoformat()
                }
                
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def _check_aws_s3_health(self) -> Dict[str, Any]:
        """Check AWS S3 health"""
        try:
            aws_access_key = os.environ.get('AWS_ACCESS_KEY_ID')
            aws_secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
            
            if not aws_access_key or not aws_secret_key:
                return {
                    'status': 'not_configured',
                    'message': 'AWS credentials not configured',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # Test S3 connection
            import boto3
            start_time = time.time()
            
            s3_client = boto3.client(
                's3',
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key
            )
            
            # List buckets to test connection
            s3_client.list_buckets()
            response_time = time.time() - start_time
            
            return {
                'status': 'healthy',
                'response_time_ms': round(response_time * 1000, 2),
                'timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def check_system_resources(self) -> Dict[str, Any]:
        """Check system resource usage"""
        try:
            if not PSUTIL_AVAILABLE:
                return {
                    'status': 'not_available',
                    'message': 'psutil not available - system metrics disabled',
                    'timestamp': datetime.utcnow().isoformat()
                }
            
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            
            # Process info
            process = psutil.Process()
            process_memory = process.memory_info().rss / 1024 / 1024  # MB
            
            # Determine health status
            status = 'healthy'
            if cpu_percent > 80 or memory_percent > 80 or disk_percent > 90:
                status = 'warning'
            if cpu_percent > 95 or memory_percent > 95 or disk_percent > 95:
                status = 'critical'
            
            return {
                'status': status,
                'cpu_percent': round(cpu_percent, 2),
                'memory_percent': round(memory_percent, 2),
                'disk_percent': round(disk_percent, 2),
                'process_memory_mb': round(process_memory, 2),
                'uptime_seconds': time.time() - self.start_time,
                'timestamp': datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"System resources check failed: {str(e)}")
            return {
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }
    
    def get_comprehensive_health(self) -> Dict[str, Any]:
        """Get comprehensive health status"""
        # Check if we can use cached results
        cache_key = 'comprehensive_health'
        if (cache_key in self.last_checks and 
            time.time() - self.last_checks[cache_key]['timestamp'] < self.check_cache_duration):
            return self.last_checks[cache_key]['data']
        
        # Perform health checks
        checks = {
            'database': self.check_database_health(),
            'supabase': self.check_supabase_health(),
            'external_services': self.check_external_services_health(),
            'system_resources': self.check_system_resources()
        }
        
        # Determine overall status
        statuses = [check['status'] for check in checks.values()]
        if 'unhealthy' in statuses:
            overall_status = 'unhealthy'
        elif 'critical' in statuses:
            overall_status = 'critical'
        elif 'warning' in statuses:
            overall_status = 'warning'
        else:
            overall_status = 'healthy'
        
        health_data = {
            'status': overall_status,
            'checks': checks,
            'timestamp': datetime.utcnow().isoformat(),
            'uptime_seconds': time.time() - self.start_time
        }
        
        # Cache the result
        self.last_checks[cache_key] = {
            'data': health_data,
            'timestamp': time.time()
        }
        
        return health_data
    
    def get_quick_health(self) -> Dict[str, Any]:
        """Get quick health status (cached)"""
        return {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'uptime_seconds': time.time() - self.start_time
        }

# Global health check service instance
health_checker = HealthCheckService()
