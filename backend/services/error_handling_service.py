"""
Enhanced Error Handling Service
Provides comprehensive error handling and recovery mechanisms
"""
import logging
import traceback
import time
from typing import Dict, Any, Optional, Callable, Type
from datetime import datetime
from functools import wraps
import requests
from requests.exceptions import ConnectionError, Timeout, RequestException

logger = logging.getLogger(__name__)

class ErrorHandlingService:
    """Service for enhanced error handling and recovery"""
    
    def __init__(self):
        self.error_counts = {}
        self.circuit_breaker_threshold = 5
        self.circuit_breaker_timeout = 300  # 5 minutes
        self.circuit_breaker_states = {}
    
    def handle_api_error(self, error: Exception, endpoint: str, 
                        user_id: Optional[str] = None) -> Dict[str, Any]:
        """Handle API errors with proper logging and response"""
        error_type = type(error).__name__
        error_message = str(error)
        
        # Log error with context
        logger.error(f"API Error in {endpoint}: {error_type} - {error_message}", 
                    extra={
                        'endpoint': endpoint,
                        'error_type': error_type,
                        'user_id': user_id,
                        'timestamp': datetime.utcnow().isoformat()
                    })
        
        # Track error rates
        self._track_error_rate(endpoint, error_type)
        
        # Determine appropriate response
        if isinstance(error, ValueError):
            return self._format_validation_error(error_message)
        elif isinstance(error, ConnectionError):
            return self._format_connection_error(error_message)
        elif isinstance(error, Timeout):
            return self._format_timeout_error(error_message)
        elif isinstance(error, PermissionError):
            return self._format_permission_error(error_message)
        else:
            return self._format_generic_error(error_message, error_type)
    
    def handle_database_error(self, error: Exception, operation: str) -> Dict[str, Any]:
        """Handle database errors with proper logging"""
        error_type = type(error).__name__
        error_message = str(error)
        
        logger.error(f"Database Error in {operation}: {error_type} - {error_message}",
                    extra={
                        'operation': operation,
                        'error_type': error_type,
                        'timestamp': datetime.utcnow().isoformat()
                    })
        
        # Track error rates
        self._track_error_rate(f"db_{operation}", error_type)
        
        if "connection" in error_message.lower():
            return self._format_connection_error("Database connection failed")
        elif "timeout" in error_message.lower():
            return self._format_timeout_error("Database operation timed out")
        elif "constraint" in error_message.lower():
            return self._format_validation_error("Database constraint violation")
        else:
            return self._format_generic_error("Database operation failed", error_type)
    
    def handle_external_service_error(self, error: Exception, service: str) -> Dict[str, Any]:
        """Handle external service errors with circuit breaker"""
        error_type = type(error).__name__
        error_message = str(error)
        
        # Check circuit breaker
        if self._is_circuit_breaker_open(service):
            return self._format_circuit_breaker_error(service)
        
        # Track error rate
        self._track_error_rate(service, error_type)
        
        logger.error(f"External Service Error ({service}): {error_type} - {error_message}",
                    extra={
                        'service': service,
                        'error_type': error_type,
                        'timestamp': datetime.utcnow().isoformat()
                    })
        
        if isinstance(error, ConnectionError):
            return self._format_connection_error(f"{service} service unavailable")
        elif isinstance(error, Timeout):
            return self._format_timeout_error(f"{service} service timeout")
        else:
            return self._format_generic_error(f"{service} service error", error_type)
    
    def _track_error_rate(self, operation: str, error_type: str):
        """Track error rates for monitoring"""
        key = f"{operation}:{error_type}"
        if key not in self.error_counts:
            self.error_counts[key] = {'count': 0, 'last_error': time.time()}
        
        self.error_counts[key]['count'] += 1
        self.error_counts[key]['last_error'] = time.time()
        
        # Check if circuit breaker should be triggered
        if self.error_counts[key]['count'] >= self.circuit_breaker_threshold:
            self._open_circuit_breaker(operation)
    
    def _is_circuit_breaker_open(self, service: str) -> bool:
        """Check if circuit breaker is open for a service"""
        if service not in self.circuit_breaker_states:
            return False
        
        state = self.circuit_breaker_states[service]
        if state['state'] == 'open':
            # Check if timeout has passed
            if time.time() - state['opened_at'] > self.circuit_breaker_timeout:
                # Try to close circuit breaker
                self._close_circuit_breaker(service)
                return False
            return True
        
        return False
    
    def _open_circuit_breaker(self, service: str):
        """Open circuit breaker for a service"""
        self.circuit_breaker_states[service] = {
            'state': 'open',
            'opened_at': time.time()
        }
        logger.warning(f"Circuit breaker opened for {service}")
    
    def _close_circuit_breaker(self, service: str):
        """Close circuit breaker for a service"""
        if service in self.circuit_breaker_states:
            self.circuit_breaker_states[service]['state'] = 'closed'
            logger.info(f"Circuit breaker closed for {service}")
    
    def _format_validation_error(self, message: str) -> Dict[str, Any]:
        """Format validation error response"""
        return {
            'success': False,
            'error': message,
            'error_code': 'VALIDATION_ERROR',
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _format_connection_error(self, message: str) -> Dict[str, Any]:
        """Format connection error response"""
        return {
            'success': False,
            'error': message,
            'error_code': 'CONNECTION_ERROR',
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _format_timeout_error(self, message: str) -> Dict[str, Any]:
        """Format timeout error response"""
        return {
            'success': False,
            'error': message,
            'error_code': 'TIMEOUT_ERROR',
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _format_permission_error(self, message: str) -> Dict[str, Any]:
        """Format permission error response"""
        return {
            'success': False,
            'error': message,
            'error_code': 'PERMISSION_ERROR',
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _format_circuit_breaker_error(self, service: str) -> Dict[str, Any]:
        """Format circuit breaker error response"""
        return {
            'success': False,
            'error': f"{service} service is temporarily unavailable",
            'error_code': 'SERVICE_UNAVAILABLE',
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def _format_generic_error(self, message: str, error_type: str) -> Dict[str, Any]:
        """Format generic error response"""
        return {
            'success': False,
            'error': message,
            'error_code': 'GENERIC_ERROR',
            'error_type': error_type,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def get_error_summary(self) -> Dict[str, Any]:
        """Get error summary for monitoring"""
        total_errors = sum(count['count'] for count in self.error_counts.values())
        
        # Group by operation
        operation_errors = {}
        for key, count in self.error_counts.items():
            operation = key.split(':')[0]
            if operation not in operation_errors:
                operation_errors[operation] = 0
            operation_errors[operation] += count['count']
        
        return {
            'total_errors': total_errors,
            'operation_errors': operation_errors,
            'circuit_breaker_states': {
                service: state['state'] 
                for service, state in self.circuit_breaker_states.items()
            },
            'timestamp': datetime.utcnow().isoformat()
        }

# Global error handling service instance
error_handler = ErrorHandlingService()

def handle_errors(func: Callable) -> Callable:
    """Decorator for automatic error handling"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            # Try to extract context from Flask request
            try:
                from flask import request
                endpoint = request.endpoint or 'unknown'
                user_id = getattr(request, 'user_id', None)
                return error_handler.handle_api_error(e, endpoint, user_id)
            except:
                # Fallback error handling
                logger.error(f"Unhandled error in {func.__name__}: {str(e)}")
                return {
                    'success': False,
                    'error': 'Internal server error',
                    'error_code': 'INTERNAL_ERROR',
                    'timestamp': datetime.utcnow().isoformat()
                }
    return wrapper

def retry_on_failure(max_retries: int = 3, delay: float = 1.0, 
                    backoff_factor: float = 2.0):
    """Decorator for retrying failed operations"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    
                    if attempt < max_retries:
                        wait_time = delay * (backoff_factor ** attempt)
                        logger.warning(f"Attempt {attempt + 1} failed, retrying in {wait_time}s: {str(e)}")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"All {max_retries + 1} attempts failed: {str(e)}")
            
            # If we get here, all retries failed
            raise last_exception
        return wrapper
    return decorator
