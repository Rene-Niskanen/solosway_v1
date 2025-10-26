"""
Performance Monitoring Service
Tracks API performance, database queries, and system metrics
"""
import time
import logging
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from functools import wraps

# Try to import optional dependencies
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logging.warning("psutil not available - system metrics will be limited")

logger = logging.getLogger(__name__)

class PerformanceService:
    """Service for monitoring and optimizing system performance"""
    
    def __init__(self):
        self.metrics = {
            'api_calls': [],
            'db_queries': [],
            'slow_queries': [],
            'error_rates': {},
            'response_times': []
        }
        self.start_time = time.time()
    
    def track_api_call(self, endpoint: str, method: str, duration: float, 
                      status_code: int, user_id: Optional[str] = None):
        """Track API call performance"""
        metric = {
            'timestamp': datetime.utcnow().isoformat(),
            'endpoint': endpoint,
            'method': method,
            'duration_ms': duration * 1000,
            'status_code': status_code,
            'user_id': user_id
        }
        
        self.metrics['api_calls'].append(metric)
        self.metrics['response_times'].append(duration)
        
        # Keep only last 1000 calls to prevent memory issues
        if len(self.metrics['api_calls']) > 1000:
            self.metrics['api_calls'] = self.metrics['api_calls'][-1000:]
            self.metrics['response_times'] = self.metrics['response_times'][-1000:]
        
        # Log slow API calls
        if duration > 0.5:  # 500ms threshold
            logger.warning(f"Slow API call: {method} {endpoint} took {duration:.3f}s")
            self.metrics['slow_queries'].append(metric)
    
    def track_db_query(self, query_name: str, duration: float, 
                      rows_returned: int = 0, error: Optional[str] = None):
        """Track database query performance"""
        metric = {
            'timestamp': datetime.utcnow().isoformat(),
            'query_name': query_name,
            'duration_ms': duration * 1000,
            'rows_returned': rows_returned,
            'error': error
        }
        
        self.metrics['db_queries'].append(metric)
        
        # Keep only last 500 queries
        if len(self.metrics['db_queries']) > 500:
            self.metrics['db_queries'] = self.metrics['db_queries'][-500:]
        
        # Log slow queries
        if duration > 0.2:  # 200ms threshold
            logger.warning(f"Slow DB query: {query_name} took {duration:.3f}s")
            self.metrics['slow_queries'].append(metric)
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get performance summary statistics"""
        if not self.metrics['response_times']:
            return {'status': 'no_data'}
        
        response_times = self.metrics['response_times']
        
        # Calculate statistics
        avg_response_time = sum(response_times) / len(response_times)
        p95_response_time = sorted(response_times)[int(len(response_times) * 0.95)]
        p99_response_time = sorted(response_times)[int(len(response_times) * 0.99)]
        
        # Count errors
        error_count = sum(1 for call in self.metrics['api_calls'] 
                         if call['status_code'] >= 400)
        total_calls = len(self.metrics['api_calls'])
        error_rate = (error_count / total_calls * 100) if total_calls > 0 else 0
        
        # System metrics
        if PSUTIL_AVAILABLE:
            memory_usage = psutil.virtual_memory().percent
            cpu_usage = psutil.cpu_percent()
        else:
            memory_usage = 0.0
            cpu_usage = 0.0
        
        return {
            'status': 'healthy' if avg_response_time < 0.2 and error_rate < 5 else 'needs_attention',
            'uptime_seconds': time.time() - self.start_time,
            'total_api_calls': total_calls,
            'total_db_queries': len(self.metrics['db_queries']),
            'slow_queries_count': len(self.metrics['slow_queries']),
            'performance_metrics': {
                'avg_response_time_ms': round(avg_response_time * 1000, 2),
                'p95_response_time_ms': round(p95_response_time * 1000, 2),
                'p99_response_time_ms': round(p99_response_time * 1000, 2),
                'error_rate_percent': round(error_rate, 2)
            },
            'system_metrics': {
                'memory_usage_percent': memory_usage,
                'cpu_usage_percent': cpu_usage
            },
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def get_slow_endpoints(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get slowest endpoints"""
        slow_calls = [call for call in self.metrics['api_calls'] 
                     if call['duration_ms'] > 500]  # 500ms threshold
        
        # Group by endpoint and calculate average
        endpoint_stats = {}
        for call in slow_calls:
            endpoint = f"{call['method']} {call['endpoint']}"
            if endpoint not in endpoint_stats:
                endpoint_stats[endpoint] = {'count': 0, 'total_duration': 0}
            endpoint_stats[endpoint]['count'] += 1
            endpoint_stats[endpoint]['total_duration'] += call['duration_ms']
        
        # Calculate averages and sort
        slow_endpoints = []
        for endpoint, stats in endpoint_stats.items():
            avg_duration = stats['total_duration'] / stats['count']
            slow_endpoints.append({
                'endpoint': endpoint,
                'avg_duration_ms': round(avg_duration, 2),
                'call_count': stats['count']
            })
        
        return sorted(slow_endpoints, key=lambda x: x['avg_duration_ms'], reverse=True)[:limit]

# Global performance service instance
performance_service = PerformanceService()

def track_performance(func):
    """Decorator to track function performance"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            duration = time.time() - start_time
            
            # Try to extract endpoint info from Flask context
            try:
                from flask import request
                endpoint = request.endpoint or 'unknown'
                method = request.method or 'unknown'
                performance_service.track_api_call(endpoint, method, duration, 200)
            except:
                pass
            
            return result
        except Exception as e:
            duration = time.time() - start_time
            try:
                from flask import request
                endpoint = request.endpoint or 'unknown'
                method = request.method or 'unknown'
                performance_service.track_api_call(endpoint, method, duration, 500)
            except:
                pass
            raise
    return wrapper

def track_db_query(query_name: str):
    """Decorator to track database query performance"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                duration = time.time() - start_time
                
                # Try to get row count if result is a list
                rows_returned = len(result) if isinstance(result, list) else 0
                performance_service.track_db_query(query_name, duration, rows_returned)
                
                return result
            except Exception as e:
                duration = time.time() - start_time
                performance_service.track_db_query(query_name, duration, 0, str(e))
                raise
        return wrapper
    return decorator
