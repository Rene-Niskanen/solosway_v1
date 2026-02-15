"""
Extended Thinking Service - Stream Claude's reasoning process

Uses Anthropic's Claude with extended thinking to show real-time
reasoning during document analysis and summarization.
"""

import os
import logging
import asyncio
from typing import AsyncGenerator, Optional, Dict, Any, List
import anthropic

logger = logging.getLogger(__name__)


class ExtendedThinkingService:
    """Service for streaming Claude's extended thinking during analysis."""
    
    def __init__(self):
        self.api_key = os.environ.get('ANTHROPIC_API_KEY', '')
        self.model = os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')
        self.thinking_budget = int(os.environ.get('ANTHROPIC_THINKING_BUDGET', '5000'))
        self.client = None
        
        if self.api_key:
            self.client = anthropic.AsyncAnthropic(api_key=self.api_key)
            logger.info(f"✅ ExtendedThinkingService initialized with model: {self.model}")
        else:
            logger.warning("⚠️ ANTHROPIC_API_KEY not set - extended thinking disabled")
    
    def is_available(self) -> bool:
        """Check if extended thinking is available."""
        return self.client is not None and bool(self.api_key)
    
    async def stream_thinking_analysis(
        self,
        query: str,
        document_context: str,
        document_outputs: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream thinking and response for document analysis.
        
        Yields events:
        - {"type": "thinking_start"}
        - {"type": "thinking_delta", "content": "..."}
        - {"type": "thinking_end"}
        - {"type": "text_start"}
        - {"type": "text_delta", "content": "..."}
        - {"type": "text_end"}
        - {"type": "complete", "thinking": "...", "response": "..."}
        """
        if not self.is_available():
            logger.warning("Extended thinking not available - falling back to synthetic")
            async for event in self._synthetic_thinking(document_outputs):
                yield event
            return
        
        # Build context from document outputs
        context_parts = []
        if document_outputs:
            for i, doc in enumerate(document_outputs[:5]):  # Limit to 5 docs
                # Use actual filename or classification type for clarity
                filename = doc.get('original_filename', '')
                doc_type = doc.get('classification_type', 'Document')
                output = doc.get('output', '')[:1000]  # Truncate long outputs
                
                # Create a clear identifier: prefer filename, fallback to doc_type
                if filename:
                    # Truncate long filenames for readability
                    display_name = filename if len(filename) <= 50 else filename[:47] + '...'
                    doc_label = f"{display_name} ({doc_type})"
                else:
                    doc_label = doc_type
                
                context_parts.append(f"{doc_label}:\n{output}")
        
        context = "\n\n".join(context_parts) if context_parts else document_context
        
        system_prompt = """You are analyzing processed document results to answer a user's query.
These are the analyzed outputs from documents that were already processed (not raw chunks).
Think through the document results step-by-step, identifying key facts, figures, and relevant information.
Your thinking should be clear and organized, noting specific findings from each document result.
When referring to documents, use their actual names/types (e.g., "Valuation Report", "Highlands_Berden...") rather than generic labels like "Document 1"."""
        
        user_message = f"""Query: {query}

Processed Document Results:
{context}

Analyze these processed document results to answer the query. Think through what you find step-by-step.
Note: These are already-processed results from documents, not raw document chunks."""

        try:
            full_thinking = ""
            full_response = ""
            
            yield {"type": "thinking_start"}
            
``            async with self.client.messages.stream(
                model=self.model,
                max_tokens=8000,
                thinking={
                    "type": "enabled",
                    "budget_tokens": self.thinking_budget
                },
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}]
            ) as stream:
                current_block_type = None
                
                async for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if hasattr(block, 'type'):
                            current_block_type = block.type
                            if current_block_type == "thinking":
                                pass  # Already yielded thinking_start
                            elif current_block_type == "text":
                                yield {"type": "thinking_end"}
                                yield {"type": "text_start"}
                    
                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if hasattr(delta, 'thinking'):
                            content = delta.thinking
                            full_thinking += content
                            yield {"type": "thinking_delta", "content": content}
                        elif hasattr(delta, 'text'):
                            content = delta.text
                            full_response += content
                            yield {"type": "text_delta", "content": content}
                    
                    elif event.type == "content_block_stop":
                        if current_block_type == "text":
                            yield {"type": "text_end"}
            
            yield {
                "type": "complete",
                "thinking": full_thinking,
                "response": full_response
            }
            
        except anthropic.APIError as e:
            logger.error(f"Anthropic API error: {e}")
            # Fall back to synthetic thinking
            async for event in self._synthetic_thinking(document_outputs):
                yield event
        except Exception as e:
            logger.error(f"Extended thinking error: {e}")
            async for event in self._synthetic_thinking(document_outputs):
                yield event
    
    async def _synthetic_thinking(
        self,
        document_outputs: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate synthetic thinking points from document outputs.
        Used as fallback when Claude extended thinking is not available.
        """
        yield {"type": "thinking_start"}
        
        if document_outputs:
            for i, doc in enumerate(document_outputs[:3]):
                # Use actual filename or classification type for clarity
                filename = doc.get('original_filename', '')
                doc_type = doc.get('classification_type', 'Document')
                output = doc.get('output', '')
                
                # Create a clear identifier: prefer filename, fallback to doc_type
                if filename:
                    display_name = filename if len(filename) <= 40 else filename[:37] + '...'
                    doc_label = f"{display_name} ({doc_type})"
                else:
                    doc_label = doc_type
                
                # Extract first meaningful line as a "thought"
                lines = [l.strip() for l in output.split('\n') if l.strip() and len(l.strip()) > 20]
                if lines:
                    thought = f"From {doc_label}: {lines[0][:100]}..."
                    yield {"type": "thinking_delta", "content": f"- {thought}\n"}
                    await asyncio.sleep(0.1)  # Small delay for effect
        else:
            yield {"type": "thinking_delta", "content": "- Analyzing document context...\n"}
            await asyncio.sleep(0.1)
        
        yield {"type": "thinking_end"}
        yield {"type": "complete", "thinking": "", "response": ""}


# Singleton instance
_thinking_service: Optional[ExtendedThinkingService] = None


def get_thinking_service() -> ExtendedThinkingService:
    """Get or create the extended thinking service instance."""
    global _thinking_service
    if _thinking_service is None:
        _thinking_service = ExtendedThinkingService()
    return _thinking_service
