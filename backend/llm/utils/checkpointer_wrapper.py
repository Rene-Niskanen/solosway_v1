"""
Checkpointer Wrapper - Filters out non-serializable fields before checkpointing.

This wrapper excludes `execution_events` from state before serialization,
since ExecutionEventEmitter is not msgpack serializable and is runtime-only.
"""

import logging
from typing import Any, Dict, Optional
from langgraph.checkpoint.base import BaseCheckpointSaver

# Import ExecutionEventEmitter to check isinstance
try:
    from backend.llm.utils.execution_events import ExecutionEventEmitter
except ImportError:
    ExecutionEventEmitter = None  # Fallback if not available

logger = logging.getLogger(__name__)


class FilteredCheckpointSaver(BaseCheckpointSaver):
    """
    Wraps a BaseCheckpointSaver to filter out non-serializable fields before checkpointing.
    
    Specifically removes `execution_events` from state before serialization.
    Inherits from BaseCheckpointSaver so LangGraph recognizes it as a valid checkpointer.
    """
    
    def __init__(self, wrapped_checkpointer: BaseCheckpointSaver):
        """Initialize with the checkpointer to wrap"""
        # Don't call super().__init__() since BaseCheckpointSaver might not have __init__
        # Just store the wrapped checkpointer
        self.wrapped = wrapped_checkpointer
    
    def _is_execution_event_emitter(self, obj: Any) -> bool:
        """Check if an object is an ExecutionEventEmitter instance"""
        if obj is None:
            return False
        
        # Check by isinstance if ExecutionEventEmitter is available (most reliable)
        if ExecutionEventEmitter and isinstance(obj, ExecutionEventEmitter):
            return True
        
        # Check by class name and type string (multiple checks for robustness)
        if hasattr(obj, '__class__'):
            class_name = obj.__class__.__name__
            if 'ExecutionEventEmitter' in class_name:
                return True
            
            # Check the full type string
            type_str = str(type(obj))
            if 'ExecutionEventEmitter' in type_str:
                return True
            
            # Check module path in type string
            if 'execution_events' in type_str.lower() and 'Emitter' in type_str:
                return True
        
        # Check if object has attributes that suggest it's an ExecutionEventEmitter
        # ExecutionEventEmitter has: events, emit, stream_queue, _lock
        if (hasattr(obj, 'events') and 
            hasattr(obj, 'emit') and 
            hasattr(obj, 'stream_queue') and
            callable(getattr(obj, 'emit', None))):
            # This looks like an ExecutionEventEmitter - be safe and filter it
            return True
        
        return False
    
    def _strip_tracers(self, obj: Any) -> Any:
        """
        Recursively remove LangSmith tracers and EventEmitter instances.
        
        This is the primary method for cleaning state before serialization.
        Removes any object that has 'EventEmitter' or 'Tracer' in its type string.
        
        CRITICAL: This must be called on ALL data structures before serialization,
        including writes, checkpoints, and any nested structures.
        """
        if obj is None:
            return None
        
        # FIRST: Check if this object itself is an EventEmitter or Tracer
        # Do this before any other checks to catch it immediately
        if hasattr(obj, '__class__'):
            type_str = str(type(obj))
            class_name = obj.__class__.__name__
            # Check module path as well
            module_name = getattr(obj.__class__, '__module__', '')
            # Remove tracers and EventEmitters by type string, class name, and module
            if ('EventEmitter' in type_str or 'EventEmitter' in class_name or 
                'EventEmitter' in module_name or 'execution_events' in module_name.lower()):
                logger.debug(f"[STRIP_TRACERS] Filtering EventEmitter: {class_name} from {module_name}")
                return None
            if 'Tracer' in type_str or 'Tracer' in class_name:
                return None
        
        # Also check using our specific ExecutionEventEmitter check
        if self._is_execution_event_emitter(obj):
            return None
        
        # Additional check: if object has ExecutionEventEmitter-like attributes, filter it
        # This catches cases where the type check might miss something
        # Check for the specific attributes that ExecutionEventEmitter has
        if (hasattr(obj, 'events') and 
            hasattr(obj, 'emit') and 
            hasattr(obj, 'stream_queue') and
            hasattr(obj, '_lock')):
            # This looks like an ExecutionEventEmitter - filter it
            logger.debug(f"[STRIP_TRACERS] Filtering ExecutionEventEmitter-like object: {type(obj)}")
            return None
        
        # Handle LangChain message objects (AIMessage, HumanMessage, etc.)
        # These need to be converted to dicts for msgpack serialization
        if hasattr(obj, '__class__'):
            class_name = obj.__class__.__name__
            if class_name in ['AIMessage', 'HumanMessage', 'SystemMessage', 'ToolMessage', 'FunctionMessage']:
                # Convert LangChain message to dict
                try:
                    # Use the message's dict() method if available
                    if hasattr(obj, 'dict'):
                        return self._strip_tracers(obj.dict())
                    # Otherwise, convert manually
                    message_dict = {
                        'type': class_name.lower().replace('message', ''),
                        'content': getattr(obj, 'content', ''),
                    }
                    # Add other attributes if they exist
                    if hasattr(obj, 'id'):
                        message_dict['id'] = obj.id
                    if hasattr(obj, 'name'):
                        message_dict['name'] = obj.name
                    if hasattr(obj, 'tool_calls'):
                        message_dict['tool_calls'] = self._strip_tracers(getattr(obj, 'tool_calls', []))
                    return message_dict
                except Exception as e:
                    logger.warning(f"[STRIP_TRACERS] Error converting {class_name} to dict: {e}, filtering it")
                    return None
        
        # Handle different container types
        if isinstance(obj, dict):
            # Filter dict, removing tracers and EventEmitters
            cleaned = {}
            for k, v in obj.items():
                # Skip execution_events key
                if k == 'execution_events':
                    continue
                # Skip tracer keys
                if k.startswith('__tracer__'):
                    continue
                
                # Check if value is a tracer or EventEmitter BEFORE recursion
                if hasattr(v, '__class__'):
                    type_str = str(type(v))
                    class_name = v.__class__.__name__
                    if 'EventEmitter' in type_str or 'EventEmitter' in class_name:
                        continue
                    if 'Tracer' in type_str or 'Tracer' in class_name:
                        continue
                
                if self._is_execution_event_emitter(v):
                    continue
                
                # Recursively clean nested structures
                cleaned_value = self._strip_tracers(v)
                # Only add if cleaned value is not None and not an EventEmitter
                if cleaned_value is not None:
                    # Double-check after recursion
                    if hasattr(cleaned_value, '__class__'):
                        type_str = str(type(cleaned_value))
                        if 'EventEmitter' in type_str or 'Tracer' in type_str:
                            continue
                    cleaned[k] = cleaned_value
            return cleaned
        elif isinstance(obj, list):
            # Filter list, removing tracers and EventEmitters
            cleaned = []
            for item in obj:
                # Skip tracers and EventEmitters BEFORE recursion
                if hasattr(item, '__class__'):
                    type_str = str(type(item))
                    class_name = item.__class__.__name__
                    if 'EventEmitter' in type_str or 'EventEmitter' in class_name:
                        continue
                    if 'Tracer' in type_str or 'Tracer' in class_name:
                        continue
                
                if self._is_execution_event_emitter(item):
                    continue
                
                # Recursively clean nested structures
                cleaned_item = self._strip_tracers(item)
                # Only add if cleaned item is not None and not an EventEmitter
                if cleaned_item is not None:
                    # Double-check after recursion
                    if hasattr(cleaned_item, '__class__'):
                        type_str = str(type(cleaned_item))
                        if 'EventEmitter' in type_str or 'Tracer' in type_str:
                            continue
                    cleaned.append(cleaned_item)
            return cleaned
        elif isinstance(obj, tuple):
            # Filter tuple, removing tracers and EventEmitters
            cleaned = []
            for item in obj:
                # Skip tracers and EventEmitters BEFORE recursion
                if hasattr(item, '__class__'):
                    type_str = str(type(item))
                    class_name = item.__class__.__name__
                    if 'EventEmitter' in type_str or 'EventEmitter' in class_name:
                        continue
                    if 'Tracer' in type_str or 'Tracer' in class_name:
                        continue
                
                if self._is_execution_event_emitter(item):
                    continue
                
                # Recursively clean nested structures
                cleaned_item = self._strip_tracers(item)
                # Only add if cleaned item is not None and not an EventEmitter
                if cleaned_item is not None:
                    # Double-check after recursion
                    if hasattr(cleaned_item, '__class__'):
                        type_str = str(type(cleaned_item))
                        if 'EventEmitter' in type_str or 'Tracer' in type_str:
                            continue
                    cleaned.append(cleaned_item)
            return tuple(cleaned)
        elif isinstance(obj, (set, frozenset)):
            # Handle sets - convert to list, filter, then back to set
            cleaned_items = []
            for item in obj:
                if hasattr(item, '__class__'):
                    type_str = str(type(item))
                    class_name = item.__class__.__name__
                    if 'EventEmitter' in type_str or 'EventEmitter' in class_name:
                        continue
                    if 'Tracer' in type_str or 'Tracer' in class_name:
                        continue
                
                if self._is_execution_event_emitter(item):
                    continue
                
                cleaned_item = self._strip_tracers(item)
                if cleaned_item is not None:
                    if hasattr(cleaned_item, '__class__'):
                        type_str = str(type(cleaned_item))
                        if 'EventEmitter' in type_str or 'Tracer' in type_str:
                            continue
                    cleaned_items.append(cleaned_item)
            
            if isinstance(obj, frozenset):
                return frozenset(cleaned_items)
            else:
                return set(cleaned_items)
        else:
            # Check for collections.deque (must be after other container checks)
            import collections
            if isinstance(obj, collections.deque):
                # Convert deque to list for serialization (deques are not msgpack serializable)
                # IMPORTANT: Preserve tuple structure if deque contains tuples (e.g., writes structure)
                # Recursively clean each item in the deque
                cleaned_items = []
                for item in obj:
                    cleaned_item = self._strip_tracers(item)
                    if cleaned_item is not None:
                        cleaned_items.append(cleaned_item)
                return cleaned_items
            # For other types (primitives, custom objects), check one more time
            if hasattr(obj, '__class__'):
                type_str = str(type(obj))
                class_name = obj.__class__.__name__
                if 'EventEmitter' in type_str or 'EventEmitter' in class_name:
                    return None
                if 'Tracer' in type_str or 'Tracer' in class_name:
                    return None
            
            # Return primitives and other objects as-is (if they passed all checks)
            return obj
    
    def _filter_state(self, state: Any) -> Any:
        """
        Recursively remove non-serializable fields from state before serialization.
        
        Removes:
        - Keys named 'execution_events'
        - ExecutionEventEmitter instances (by type check and class name)
        - Keys starting with '__tracer__'
        """
        # Check if value is an ExecutionEventEmitter instance
        if self._is_execution_event_emitter(state):
            return None
        
        if isinstance(state, dict):
            filtered = {}
            for k, v in state.items():
                # Skip execution_events key
                if k == 'execution_events':
                    continue
                
                # Skip tracer keys (LangGraph/LangSmith tracers)
                if k.startswith('__tracer__'):
                    continue
                
                # Skip if value is ExecutionEventEmitter instance
                if self._is_execution_event_emitter(v):
                    continue
                
                # Recursively filter nested structures
                filtered_value = self._filter_state(v)
                # Skip None values that came from ExecutionEventEmitter filtering
                if filtered_value is None and self._is_execution_event_emitter(v):
                    continue
                filtered[k] = filtered_value
            return filtered
        elif isinstance(state, list):
            # Filter lists recursively, removing None values from ExecutionEventEmitter instances
            filtered_list = []
            for item in state:
                # Skip ExecutionEventEmitter instances before filtering
                if self._is_execution_event_emitter(item):
                    continue
                filtered_item = self._filter_state(item)
                # Skip None values (from ExecutionEventEmitter instances)
                if filtered_item is not None:
                    filtered_list.append(filtered_item)
            return filtered_list
        elif isinstance(state, tuple):
            # Filter tuples recursively
            filtered_items = []
            for item in state:
                if self._is_execution_event_emitter(item):
                    continue
                filtered_item = self._filter_state(item)
                if filtered_item is not None:
                    filtered_items.append(filtered_item)
            return tuple(filtered_items)
        else:
            # Return primitives as-is
            return state
    
    # Delegate all methods to wrapped checkpointer, filtering state in aput/put
    async def aput(self, config: Dict, checkpoint: Dict, metadata: Dict, new_versions: Dict) -> Dict:
        """Put checkpoint, stripping tracers and EventEmitters before serialization"""
        # CLEAN TRACERS BEFORE SAVE (primary fix from LangGraph docs)
        clean_checkpoint = self._strip_tracers(checkpoint)
        
        return await self.wrapped.aput(config, clean_checkpoint, metadata, new_versions)
    
    def put(self, config: Dict, checkpoint: Dict, metadata: Dict, new_versions: Dict) -> Dict:
        """Put checkpoint (sync), stripping tracers and EventEmitters before serialization"""
        # CLEAN TRACERS BEFORE SAVE (primary fix from LangGraph docs)
        clean_checkpoint = self._strip_tracers(checkpoint)
        
        return self.wrapped.put(config, clean_checkpoint, metadata, new_versions)
    
    async def aput_writes(self, config: Dict, writes: Dict, task_id: Optional[str] = None) -> None:
        """Put writes (required by LangGraph for checkpoint writes)"""
        # CLEAN TRACERS BEFORE SAVE (critical - writes can contain tracers with EventEmitters)
        if writes:
            clean_writes = self._strip_tracers(writes)
            
            # Validate writes structure: should be a list of tuples (channel, value)
            # LangGraph may pass writes in different formats:
            # - (channel, value) tuples (2 elements) - standard format
            # - (channel,) tuples (1 element) - channel-only writes (valid, convert to (channel, None))
            # - dict format - convert to list of tuples
            if isinstance(clean_writes, list):
                validated_writes = []
                for item in clean_writes:
                    if isinstance(item, (list, tuple)):
                        if len(item) == 2:
                            # Valid tuple/list of 2 elements (channel, value)
                            validated_writes.append(tuple(item))
                        elif len(item) == 1:
                            # Single-element tuple (channel only) - convert to (channel, None)
                            # This is valid in some LangGraph contexts
                            validated_writes.append((item[0], None))
                        else:
                            # Invalid length - skip with debug log (not warning)
                            logger.debug(f"[STRIP_TRACERS] Skipping writes item with unexpected length {len(item)}: {str(item)[:100]}")
                            continue
                    elif isinstance(item, dict):
                        # Convert dict to tuple format if it has 'channel' key
                        if 'channel' in item:
                            value = item.get('value', None)
                            validated_writes.append((item['channel'], value))
                        else:
                            logger.debug(f"[STRIP_TRACERS] Skipping dict writes item without 'channel' key: {type(item)}")
                            continue
                    else:
                        # Non-tuple, non-dict item - skip with debug log
                        logger.debug(f"[STRIP_TRACERS] Skipping non-tuple writes item: {type(item)}")
                        continue
                clean_writes = validated_writes
            
            # Final safety check: recursively verify no EventEmitters remain using msgpack
            # (the actual serialization format used by LangGraph checkpointer)
            try:
                import ormsgpack
                # Try to serialize with msgpack to catch any remaining non-serializable objects
                ormsgpack.packb(clean_writes)
            except TypeError as e:
                logger.warning(f"⚠️  Cleaned writes still contains non-serializable objects: {e}")
                # Try one more aggressive pass
                clean_writes = self._strip_tracers(clean_writes)
                # Validate again after second pass
                if isinstance(clean_writes, list):
                    validated_writes = []
                    for item in clean_writes:
                        if isinstance(item, (list, tuple)) and len(item) == 2:
                            validated_writes.append(tuple(item))
                    clean_writes = validated_writes
                # Try again
                try:
                    ormsgpack.packb(clean_writes)
                except TypeError as e2:
                    logger.error(f"❌ Failed to serialize cleaned writes after second pass: {e2}")
                    # Log the problematic structure for debugging
                    import json
                    try:
                        logger.error(f"Problematic writes structure: {json.dumps(clean_writes, default=str, indent=2)[:500]}")
                    except:
                        logger.error(f"Could not serialize writes for logging")
                    raise
        else:
            clean_writes = writes
        
        # Delegate to wrapped checkpointer (should have aput_writes)
        return await self.wrapped.aput_writes(config, clean_writes, task_id)
    
    def put_writes(self, config: Dict, writes: Dict, task_id: Optional[str] = None) -> None:
        """Put writes (sync, required by LangGraph for checkpoint writes)"""
        # CLEAN TRACERS BEFORE SAVE (critical - writes can contain tracers with EventEmitters)
        if writes:
            clean_writes = self._strip_tracers(writes)
            
            # Validate writes structure: should be a list of tuples (channel, value)
            # LangGraph may pass writes in different formats - handle gracefully
            if isinstance(clean_writes, list):
                validated_writes = []
                for item in clean_writes:
                    if isinstance(item, (list, tuple)):
                        if len(item) == 2:
                            # Valid tuple/list of 2 elements (channel, value)
                            validated_writes.append(tuple(item))
                        elif len(item) == 1:
                            # Single-element tuple (channel only) - convert to (channel, None)
                            validated_writes.append((item[0], None))
                        else:
                            # Invalid length - skip with debug log
                            logger.debug(f"[STRIP_TRACERS] Skipping writes item with unexpected length {len(item)}: {str(item)[:100]}")
                            continue
                    elif isinstance(item, dict):
                        # Convert dict to tuple format if it has 'channel' key
                        if 'channel' in item:
                            value = item.get('value', None)
                            validated_writes.append((item['channel'], value))
                        else:
                            logger.debug(f"[STRIP_TRACERS] Skipping dict writes item without 'channel' key: {type(item)}")
                            continue
                    else:
                        # Non-tuple, non-dict item - skip with debug log
                        logger.debug(f"[STRIP_TRACERS] Skipping non-tuple writes item: {type(item)}")
                        continue
                clean_writes = validated_writes
            
            # Final safety check: recursively verify no EventEmitters remain using msgpack
            try:
                import ormsgpack
                # Try to serialize with msgpack to catch any remaining non-serializable objects
                ormsgpack.packb(clean_writes)
            except TypeError as e:
                logger.warning(f"⚠️  Cleaned writes still contains non-serializable objects: {e}")
                # Try one more aggressive pass
                clean_writes = self._strip_tracers(clean_writes)
                # Validate again after second pass
                if isinstance(clean_writes, list):
                    validated_writes = []
                    for item in clean_writes:
                        if isinstance(item, (list, tuple)) and len(item) == 2:
                            validated_writes.append(tuple(item))
                    clean_writes = validated_writes
                # Try again
                try:
                    ormsgpack.packb(clean_writes)
                except TypeError as e2:
                    logger.error(f"❌ Failed to serialize cleaned writes after second pass: {e2}")
                    raise
        else:
            clean_writes = writes
        
        # Delegate to wrapped checkpointer (should have put_writes)
        return self.wrapped.put_writes(config, clean_writes, task_id)
    
    # Delegate all other methods
    async def aget(self, config: Dict) -> Optional[Dict]:
        """Get checkpoint"""
        return await self.wrapped.aget(config)
    
    def get(self, config: Dict) -> Optional[Dict]:
        """Get checkpoint (sync)"""
        return self.wrapped.get(config)
    
    async def aget_tuple(self, config: Dict):
        """Get checkpoint tuple (required by LangGraph)"""
        return await self.wrapped.aget_tuple(config)
    
    def get_tuple(self, config: Dict):
        """Get checkpoint tuple (sync, required by LangGraph)"""
        return self.wrapped.get_tuple(config)
    
    def get_next_version(self, checkpoint: Optional[Dict], channel_writes: Dict) -> int:
        """Get next version number for checkpoint (required by LangGraph)"""
        # Ensure we're calling the wrapped checkpointer's method, not the base class
        if hasattr(self.wrapped, 'get_next_version'):
            return self.wrapped.get_next_version(checkpoint, channel_writes)
        else:
            # Fallback: if wrapped doesn't have it, raise with helpful error
            raise NotImplementedError(
                f"Wrapped checkpointer {type(self.wrapped)} does not implement get_next_version"
            )
    
    async def alist(self, config: Dict, filter: Optional[Dict] = None, before: Optional[str] = None, limit: Optional[int] = None) -> list:
        """List checkpoints"""
        return await self.wrapped.alist(config, filter, before, limit)
    
    def list(self, config: Dict, filter: Optional[Dict] = None, before: Optional[str] = None, limit: Optional[int] = None) -> list:
        """List checkpoints (sync)"""
        return self.wrapped.list(config, filter, before, limit)
    
    async def asetup(self) -> None:
        """Setup checkpointer tables (async)"""
        return await self.wrapped.asetup()
    
    def setup(self) -> None:
        """Setup checkpointer tables (sync)"""
        return self.wrapped.setup()
    
    def __getattr__(self, name):
        """Delegate unknown attributes to wrapped checkpointer"""
        return getattr(self.wrapped, name)

