"""
Model Factory - Instantiate LLM based on user preference

Maps frontend model IDs to actual LLM instances (OpenAI or Anthropic).
Used throughout the LLM pipeline to enable dynamic model selection.
"""

import logging
from typing import Optional, Literal
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from ..config import config

logger = logging.getLogger(__name__)

# Map frontend model IDs to (provider, actual_model_name)
MODEL_MAPPING = {
    'gpt-4o-mini': ('openai', 'gpt-4o-mini'),
    'gpt-4o': ('openai', 'gpt-4o'),
    'claude-sonnet': ('anthropic', 'claude-sonnet-4-20250514'),
    'claude-opus': ('anthropic', 'claude-opus-4-20250514'),
}

# Type for model preference
ModelPreference = Literal['gpt-4o-mini', 'gpt-4o', 'claude-sonnet', 'claude-opus']


def get_llm(
    model_preference: Optional[str] = None,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    **kwargs
):
    """
    Get LLM instance based on user preference.
    
    Args:
        model_preference: Frontend model ID ('gpt-4o-mini', 'gpt-4o', 'claude-sonnet', 'claude-opus')
        temperature: LLM temperature (default 0 for deterministic)
        max_tokens: Maximum tokens for response (optional)
        **kwargs: Additional arguments passed to the LLM constructor
        
    Returns:
        ChatOpenAI or ChatAnthropic instance
    """
    model_id = model_preference or 'gpt-4o-mini'
    
    # Get provider and model name from mapping
    mapping = MODEL_MAPPING.get(model_id)
    if not mapping:
        logger.warning(f"Unknown model preference '{model_id}', falling back to gpt-4o-mini")
        mapping = MODEL_MAPPING['gpt-4o-mini']
    
    provider, model_name = mapping
    
    if provider == 'anthropic':
        if not config.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY not set, falling back to OpenAI")
            return ChatOpenAI(
                api_key=config.openai_api_key,
                model='gpt-4o-mini',
                temperature=temperature,
                **({"max_tokens": max_tokens} if max_tokens else {}),
                **kwargs
            )
        
        logger.info(f"Using Anthropic model: {model_name}")
        return ChatAnthropic(
            api_key=config.anthropic_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )
    else:
        logger.info(f"Using OpenAI model: {model_name}")
        return ChatOpenAI(
            api_key=config.openai_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )


def get_model_info(model_preference: Optional[str] = None) -> dict:
    """
    Get information about a model preference.
    
    Returns:
        dict with 'provider', 'model_name', and 'display_name'
    """
    model_id = model_preference or 'gpt-4o-mini'
    mapping = MODEL_MAPPING.get(model_id, MODEL_MAPPING['gpt-4o-mini'])
    provider, model_name = mapping
    
    display_names = {
        'gpt-4o-mini': 'GPT-4o mini',
        'gpt-4o': 'GPT-4o',
        'claude-sonnet': 'Claude Sonnet 4',
        'claude-opus': 'Claude Opus 4',
    }
    
    return {
        'provider': provider,
        'model_name': model_name,
        'display_name': display_names.get(model_id, model_id),
    }
