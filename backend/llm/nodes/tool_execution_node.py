"""
Execution-Aware Tool Node - Wraps LangGraph's ToolNode to emit execution events.

This node intercepts tool calls and emits execution events before/after tool execution,
without coupling tools directly to state or emitter.
"""

import logging
from typing import Any, Dict
from langgraph.prebuilt import ToolNode
from backend.llm.types import MainWorkflowState
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter

logger = logging.getLogger(__name__)


class ExecutionAwareToolNode:
    """
    Wraps LangGraph's ToolNode to emit execution events.
    
    REFINED: Emitter accessed from state, tools remain framework-agnostic.
    """
    
    def __init__(self, tools: list):
        """Initialize with tools list (same as ToolNode)"""
        self.tool_node = ToolNode(tools)
        self.tool_map = {tool.name: tool for tool in tools}
        
        # Store original plan_step function for restoration
        plan_step_tool = self.tool_map.get("plan_step")
        if plan_step_tool:
            plan_step_tool._original_func = plan_step_tool.func
        
        # Store original plan_step function for restoration
        plan_step_tool = self.tool_map.get("plan_step")
        if plan_step_tool:
            plan_step_tool._original_func = plan_step_tool.func
    
    async def __call__(self, state: MainWorkflowState) -> Dict[str, Any]:
        """
        Execute tools and emit execution events.
        
        Args:
            state: MainWorkflowState with messages and execution_events
            
        Returns:
            Updated state with ToolMessages
        """
        messages = state.get("messages", [])
        emitter = state.get("execution_events")  # Get emitter from state
        
        # Find tool calls in last message
        last_message = messages[-1] if messages else None
        if not hasattr(last_message, 'tool_calls') or not last_message.tool_calls:
            # No tool calls - just pass through
            return await self.tool_node.ainvoke(state)

        # Inject business_id (and optional scope) into retrieval tools so they always run scoped to the user
        business_id = state.get("business_id")
        property_id = state.get("property_id")
        document_ids = state.get("document_ids")
        if business_id or property_id or document_ids:
            injected_tool_calls = []
            for tool_call in last_message.tool_calls:
                name = tool_call.get("name") or ""
                args = dict(tool_call.get("args") or {})
                if name == "retrieve_documents":
                    if business_id is not None:
                        args["business_id"] = business_id
                    if property_id is not None:
                        args["property_id"] = property_id
                    if document_ids is not None:
                        args["document_ids"] = document_ids
                elif name == "retrieve_chunks":
                    if business_id is not None:
                        args["business_id"] = business_id
                injected_tool_calls.append({**tool_call, "args": args})
            # Build new last message with injected args (preserve message class and id)
            try:
                new_last = last_message.copy(update={"tool_calls": injected_tool_calls})
            except Exception:
                new_last = last_message
                logger.debug("Could not copy message for tool arg injection, using original")
            else:
                state = {**state, "messages": list(messages[:-1]) + [new_last]}

        # Use the (possibly injected) tool calls for emission and execution
        current_messages = state.get("messages", messages)
        last_msg = current_messages[-1] if current_messages else None
        tool_calls_list = getattr(last_msg, "tool_calls", None) or []
        
        # Emit events for each tool call
        pre_events = {}
        for tool_call in tool_calls_list:
            tool_name = tool_call.get('name', 'unknown')
            tool_args = tool_call.get('args', {})
            
            if emitter:
                # Create description based on tool name
                if tool_name == "plan_step":
                    # plan_step emits its own event, so we don't need to emit here
                    # But we still track it in pre_events for emitter injection
                    description = tool_args.get('intent', 'Planning next action')
                elif tool_name == "retrieve_documents":
                    query = tool_args.get('query', '')[:50]
                    description = f"Searched for documents matching '{query}{'...' if len(tool_args.get('query', '')) > 50 else ''}'"
                elif tool_name == "retrieve_chunks":
                    doc_ids = tool_args.get('document_ids', [])
                    query = tool_args.get('query', '')[:50]
                    description = f"Retrieved chunks from {len(doc_ids)} document(s) for '{query}{'...' if len(tool_args.get('query', '')) > 50 else ''}'"
                else:
                    description = f"Executing {tool_name}"
                
                # Only emit event if not plan_step (plan_step emits its own)
                if tool_name != "plan_step":
                    pre_event = ExecutionEvent(
                        type="tool" if tool_name not in ["retrieve_documents", "retrieve_chunks"] else tool_name,
                        description=description,
                        metadata={
                            "tool": tool_name,
                            "args": {k: str(v)[:100] for k, v in tool_args.items() if k not in ['emitter']}
                        }
                    )
                    emitter.emit(pre_event)
                    pre_events[tool_name] = pre_event
                else:
                    # For plan_step, we still track it but don't emit (it emits its own)
                    pre_events[tool_name] = None
                
        
        # Inject emitter into plan_step tool calls before execution
        # This allows plan_step to emit execution events
        if emitter and "plan_step" in pre_events:
            # Get the plan_step tool and wrap it to inject emitter
            plan_step_tool = self.tool_map.get("plan_step")
            if plan_step_tool:
                # Import the internal implementation
                from backend.llm.tools.planning_tool import _plan_step_impl
                
                # Create a wrapper that injects emitter and calls the internal impl
                def plan_step_with_emitter(intent: str, next_action: str):
                    return _plan_step_impl(intent, next_action, emitter=emitter)
                
                # Temporarily replace the tool function
                plan_step_tool.func = plan_step_with_emitter
        
        # Execute tools (ToolNode handles this)
        result = await self.tool_node.ainvoke(state)
        
        # Restore original plan_step function after execution
        if emitter and "plan_step" in pre_events:
            plan_step_tool = self.tool_map.get("plan_step")
            if plan_step_tool and hasattr(plan_step_tool, '_original_func'):
                plan_step_tool.func = plan_step_tool._original_func
        
        # Emit post events (linked to pre-events)
        if emitter and pre_events:
            # Get tool results from result messages
            result_messages = result.get("messages", [])
            for msg in result_messages:
                if hasattr(msg, 'name') and msg.name in pre_events:
                    # Skip plan_step - it doesn't need a post-event (it's just planning)
                    if msg.name == "plan_step":
                        continue
                    
                    pre_event = pre_events[msg.name]
                    if pre_event is None:
                        continue
                    
                    # Try to extract result info
                    result_info = "Completed"
                    if hasattr(msg, 'content'):
                        content = str(msg.content)
                        if "document_id" in content or "chunk_id" in content:
                            # Try to count results
                            # Extract split operation outside f-string (backslashes not allowed in f-string expressions)
                            if "document_id" in content:
                                newline = '\n'
                                lines_with_doc_id = [l for l in content.split(newline) if 'document_id' in l]
                                result_info = f"Found {len(lines_with_doc_id)} documents"
                            elif "chunk_id" in content:
                                newline = '\n'
                                lines_with_chunk_id = [l for l in content.split(newline) if 'chunk_id' in l]
                                result_info = f"Retrieved {len(lines_with_chunk_id)} chunks"
                    
                    post_event = ExecutionEvent(
                        type=pre_event.type,
                        description=result_info,
                        metadata={"success": True},
                        parent_event_id=pre_event.event_id  # Link to pre-event
                    )
                    emitter.emit(post_event)
        
        return result
    
    # Delegate other methods to tool_node
    def __getattr__(self, name):
        """Delegate unknown attributes to tool_node"""
        return getattr(self.tool_node, name)

